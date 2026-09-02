#!/usr/bin/env python3
"""
PHASE 2 — AVERAGE DOWN BACKTEST (production-aligned).
=========================================================
يختبر هل المتوسط السعري (Average Down) بيحسن Expectancy ولا بيضر.

سيناريوهين:
  1. NO_AVG: دخول عادي + ستوب عادي (لا متوسط) — الـ baseline.
  2. AVG_DOWN: نفس الإشارات + السماح بمتوسط مرة واحدة (نصف حجم الصفقة)
     لو is_liquidity_grab_opportunity تحققت بعد الدخول.

المقاييس:
  - Expectancy (متوسط العائد لكل صفقة).
  - Win Rate.
  - Max Drawdown.
  - Profit Factor.
  - نسبة الصفقات اللي المتوسط حوّلها من خسارة لربح (flipped).

قواعد صارمة:
  - الستوب يفضل موجود. المتوسط مش بديل للستوب.
  - المتوسط مرة واحدة بس كحد أقصى.
  - حجم المتوسط = 50% من الصفقة الأصلية.
  - سعر المتوسط = السعر الحالي عند تفعيل الفرصة.

الاستراتيجيات اللي بتختبر: 3 (الـvariants اللي اجتازت Phase 1 — DD ≤ 25%):
  - Correction [A]  (Close > SMA50)
  - Correction [B]  (Close > SMA20 AND Close > SMA50)
  - Merged-Strict [B]  (نفس مع regime B)

الإعداد:
  - نفس محرك الخروج الموحد.
  - نفس الفترتين (6 شهور + كاملة).
  - no lookahead.
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

from strategies_merge import common, correction_strategy, merged_strict_strategy
from analyzers.regime_filter import passes_regime_filter
from analyzers.strict_entry_filters import evaluate_average_down

DB = PROJECT / 'db' / 'vps_real' / 'price_history.db'
if not DB.exists():
    DB = PROJECT / 'db' / 'price_history.db'

STOP_LOSS_PCT = -7.0       # same as common.py
TAKE_PROFIT_PCT = 12.0


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


def simulate_trade_no_avg(g: pd.DataFrame, entry_idx: int):
    """سيناريو 1: بدون متوسط (baseline). يرجع Trade + outcome."""
    n = len(g)
    fill_idx = entry_idx + 1
    if fill_idx >= n:
        return None
    entry_price = float(g.iloc[fill_idx]["open"])
    if entry_price <= 0:
        return None
    stop = entry_price * (1.0 + STOP_LOSS_PCT / 100.0)
    target = entry_price * (1.0 + TAKE_PROFIT_PCT / 100.0)

    for i in range(fill_idx, min(fill_idx + 25, n)):
        row = g.iloc[i]
        low = float(row["low"]); high = float(row["high"]); close = float(row["close"])
        if low <= stop:
            return {"outcome": "stop", "ret_pct": ((stop - entry_price) / entry_price * 100),
                    "days": i - fill_idx + 1, "exit_reason": "stop_loss",
                    "entry_price": entry_price, "exit_price": stop,
                    "avg_used": False, "flipped": False}
        if high >= target:
            return {"outcome": "target", "ret_pct": ((target - entry_price) / entry_price * 100),
                    "days": i - fill_idx + 1, "exit_reason": "take_profit",
                    "entry_price": entry_price, "exit_price": target,
                    "avg_used": False, "flipped": False}

    last_close = float(g.iloc[min(fill_idx + 24, n - 1)]["close"])
    return {"outcome": "timeout", "ret_pct": ((last_close - entry_price) / entry_price * 100),
            "days": 25, "exit_reason": "review_alert",
            "entry_price": entry_price, "exit_price": last_close,
            "avg_used": False, "flipped": False}


def simulate_trade_with_avg(g: pd.DataFrame, entry_idx: int, regime_mode: str | None = None,
                              debug: bool = False):
    """سيناريو 2: مع متوسط مرة واحدة لو تحققت is_liquidity_grab_opportunity.

    المتوسط بيغير:
      - متوسط سعر الدخول (new_avg_entry = (entry + avg_price) / 2).
      - الحجم بيزيد 50% (نتيجة العائد بـ تتضرب بـ 1.5x لما نحسب على الحجم الكلي).
      - الستوب بيفضل زي ما هو.

    الـ exit logic: نختبر stop على أدنى قاع من الدخول الأصلي (لأن stop = original).
    """
    n = len(g)
    fill_idx = entry_idx + 1
    if fill_idx >= n:
        return None
    entry_price = float(g.iloc[fill_idx]["open"])
    if entry_price <= 0:
        return None
    stop = entry_price * (1.0 + STOP_LOSS_PCT / 100.0)
    target = entry_price * (1.0 + TAKE_PROFIT_PCT / 100.0)

    avg_used = False
    avg_price = None
    avg_entry = entry_price  # gets updated if avg happens
    avg_size_multiplier = 1.0  # 1.0 = no avg, 1.5 = added 50%

    # Iterate forward; at each bar check (a) avg opportunity BEFORE exit (opp fires during the day, exit on close)
    for i in range(fill_idx, min(fill_idx + 25, n)):
        row = g.iloc[i]
        low = float(row["low"]); high = float(row["high"]); close = float(row["close"])

        # 1) Check avg opportunity first (only if not already averaged and we have enough bars)
        # Opp is evaluated BEFORE exit so a grab during the day can trigger the avg.
        if not avg_used and i > fill_idx:
            sub_closes = g["close"].iloc[: i + 1].tolist()
            sub_highs = g["high"].iloc[: i + 1].tolist()
            sub_lows = g["low"].iloc[: i + 1].tolist()
            sub_volumes = g["volume"].iloc[: i + 1].tolist()
            sma50_val = row.get("ma_50", None)
            if pd.isna(sma50_val):
                sma50_val = None
            else:
                sma50_val = float(sma50_val)

            ad = evaluate_average_down(
                sub_closes, sub_highs, sub_lows, sub_volumes,
                original_entry=entry_price, original_stop=stop,
                current_price=close, sma50=sma50_val,
                already_averaged=False
            )
            if ad["should_average"]:
                avg_used = True
                avg_price = close

        # 2) Exit checks (stop is original — hits regardless of avg)
        if low <= stop:
            if avg_used and avg_price is not None:
                total_cost = entry_price + 0.5 * avg_price
                total_exit = stop * 1.5
                ret_pct = (total_exit - total_cost) / total_cost * 100
            else:
                ret_pct = (stop - entry_price) / entry_price * 100
            return {"outcome": "stop", "ret_pct": ret_pct,
                    "days": i - fill_idx + 1, "exit_reason": "stop_loss",
                    "entry_price": entry_price, "exit_price": stop,
                    "avg_used": avg_used, "avg_price": avg_price,
                    "flipped": False}

        if high >= target:
            if avg_used and avg_price is not None:
                total_cost = entry_price + 0.5 * avg_price
                total_exit = target * 1.5
                ret_pct = (total_exit - total_cost) / total_cost * 100
            else:
                ret_pct = (target - entry_price) / entry_price * 100
            return {"outcome": "target", "ret_pct": ret_pct,
                    "days": i - fill_idx + 1, "exit_reason": "take_profit",
                    "entry_price": entry_price, "exit_price": target,
                    "avg_used": avg_used, "avg_price": avg_price,
                    "flipped": False}

    # timeout
    last_close = float(g.iloc[min(fill_idx + 24, n - 1)]["close"])
    if avg_used and avg_price is not None:
        total_cost = entry_price + 0.5 * avg_price
        total_exit = last_close * 1.5
        ret_pct = (total_exit - total_cost) / total_cost * 100
        # was it a flip? if without avg it would have been a loss but with avg it's a win
        baseline_ret = (last_close - entry_price) / entry_price * 100
        flipped = baseline_ret < 0 and ret_pct > 0
    else:
        ret_pct = (last_close - entry_price) / entry_price * 100
        flipped = False
    return {"outcome": "timeout", "ret_pct": ret_pct,
            "days": 25, "exit_reason": "review_alert",
            "entry_price": entry_price, "exit_price": last_close,
            "avg_used": avg_used, "avg_price": avg_price,
            "flipped": flipped}


def run_scenario(strat_mod, frames_with_indicators, scenario: str, regime_mode: str | None,
                  start_date: str, end_date: str):
    """Run a strategy with a scenario (NO_AVG or AVG_DOWN) + regime filter."""
    trades_out = []
    n_avg_used = 0
    n_flipped = 0
    for df_i in frames_with_indicators:
        signals = strat_mod.find_entry_signals(df_i)
        for entry_idx in signals:
            # regime filter
            if regime_mode is not None:
                sub_closes = df_i["close"].iloc[: entry_idx + 1].tolist()
                if not passes_regime_filter(sub_closes, mode=regime_mode):
                    continue
            # window filter
            entry_date = pd.Timestamp(df_i.iloc[entry_idx + 1]["date"]) if entry_idx + 1 < len(df_i) else None
            if entry_date is None:
                continue
            entry_str = entry_date.strftime('%Y-%m-%d')
            if not (start_date <= entry_str <= end_date):
                continue

            if scenario == "NO_AVG":
                result = simulate_trade_no_avg(df_i, entry_idx)
            else:
                result = simulate_trade_with_avg(df_i, entry_idx, regime_mode)
            if result is None:
                continue
            trades_out.append({
                "ticker": df_i.iloc[0]["ticker"],
                "entry_date": entry_str,
                "entry_price": round(result["entry_price"], 3),
                "exit_price": round(result["exit_price"], 3),
                "return_pct": round(result["ret_pct"], 2),
                "exit_reason": result["exit_reason"],
                "holding_days": result["days"],
                "avg_used": result.get("avg_used", False),
                "flipped": result.get("flipped", False),
            })
            if result.get("avg_used"):
                n_avg_used += 1
            if result.get("flipped"):
                n_flipped += 1
    return trades_out, n_avg_used, n_flipped


def compute_metrics(trades, label):
    if not trades:
        return {"label": label, "trades": 0, "win_rate_pct": 0, "avg_return_pct": 0,
                "total_return_pct": 0, "max_drawdown_pct": 0, "profit_factor": 0,
                "expectancy": 0}
    rets = np.array([t["return_pct"] for t in trades])
    wins = rets[rets > 0]
    losses = rets[rets <= 0]
    gross_win = wins.sum() if len(wins) else 0.0
    gross_loss = abs(losses.sum()) if len(losses) else 0.0
    pf = (gross_win / gross_loss) if gross_loss > 0 else (float('inf') if gross_win > 0 else 0.0)
    # equity curve
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    for r in rets:
        equity *= (1.0 + r / 100.0)
        peak = max(peak, equity)
        dd = (equity / peak - 1.0) * 100.0
        max_dd = min(max_dd, dd)
    total_ret = (equity - 1.0) * 100.0
    return {
        "label": label,
        "trades": len(trades),
        "win_rate_pct": round(float(len(wins)) / len(trades) * 100.0, 2),
        "avg_return_pct": round(float(rets.mean()), 2),
        "total_return_pct": round(float(total_ret), 2),
        "max_drawdown_pct": round(float(max_dd), 2),
        "profit_factor": round(float(pf), 2) if pf != float('inf') else 999.99,
        "expectancy": round(float(rets.mean()), 3),  # متوسط العائد لكل صفقة = expectancy
    }


def main():
    print("=" * 80)
    print("PHASE 2 — AVERAGE DOWN BACKTEST (production-aligned)")
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

    # Strategies that passed Phase 1 (DD ≤ 25% on full window)
    strategies = [
        ("Correction [A]", correction_strategy, 'A'),
        ("Correction [B]", correction_strategy, 'B'),
        ("Merged-Strict [B]", merged_strict_strategy, 'B'),
    ]

    print("\n[3/3] Running 3 strategies × 2 scenarios × 2 windows = 12 runs...")

    results = {}
    for strat_label, mod, regime_mode in strategies:
        for window_label, start_date, end_date in [
            ("6mo", "2026-02-01", "2026-08-14"),
            ("full", "2025-01-09", "2026-08-17"),
        ]:
            key_no_avg = f"{strat_label} [{window_label}] NO_AVG"
            key_avg = f"{strat_label} [{window_label}] AVG_DOWN"

            trades_no, _, _ = run_scenario(mod, frames, "NO_AVG", regime_mode, start_date, end_date)
            trades_avg, n_avg, n_flip = run_scenario(mod, frames, "AVG_DOWN", regime_mode, start_date, end_date)

            m_no = compute_metrics(trades_no, key_no_avg)
            m_avg = compute_metrics(trades_avg, key_avg)
            m_avg["avg_used_count"] = n_avg
            m_avg["flipped_count"] = n_flip
            m_avg["flip_rate_pct"] = round(n_flip / m_avg["trades"] * 100, 2) if m_avg["trades"] else 0
            m_avg["avg_rate_pct"] = round(n_avg / m_avg["trades"] * 100, 2) if m_avg["trades"] else 0

            results[key_no_avg] = m_no
            results[key_avg] = m_avg

            delta_exp = m_avg["expectancy"] - m_no["expectancy"]
            delta_dd = m_avg["max_drawdown_pct"] - m_no["max_drawdown_pct"]
            verdict = "🟢 تحسّن" if delta_exp > 0 and delta_dd <= 0 else (
                "🔴 تدهور" if delta_exp < 0 or delta_dd > 5 else "🟡 محايد"
            )
            print(f"  {key_no_avg:50s} exp={m_no['expectancy']:+6.3f}%  DD={m_no['max_drawdown_pct']:+7.2f}%  PF={m_no['profit_factor']:5.2f}")
            print(f"  {key_avg:50s} exp={m_avg['expectancy']:+6.3f}%  DD={m_avg['max_drawdown_pct']:+7.2f}%  PF={m_avg['profit_factor']:5.2f}  "
                  f"avgUsed={n_avg}  flipped={n_flip}  → {verdict}")

    payload = {
        "meta": {
            "data_source": f"REAL EGX price_history.db — {len(frames)} alpha tickers",
            "windows": {"6mo": "2026-02-01 → 2026-08-14", "full": "2025-01-09 → 2026-08-17"},
            "scenarios": {
                "NO_AVG": "دخول عادي + ستوب عادي (لا متوسط)",
                "AVG_DOWN": "نفس الإشارات + السماح بمتوسط مرة واحدة (50% حجم) لو is_liquidity_grab_opportunity تحققت",
            },
            "production_modules": [
                "vps-service/analyzers/regime_filter.py",
                "vps-service/analyzers/strict_entry_filters.py (is_liquidity_grab_opportunity, evaluate_average_down)",
            ],
            "exit_engine": "shared/structural: stop_loss(-7%), take_profit(+12%), review_alert(25d cap)",
            "rules": [
                "الستوب يفضل موجود — مش بديل للستوب",
                "المتوسط مرة واحدة بس",
                "حجم المتوسط = 50% من الصفقة الأصلية",
                "الـ new stop = original stop (مش أوسع)",
            ],
        },
        "results": results,
    }

    out = PROJECT / 'data' / 'merge_backtest_real' / 'phase2_avg_down_results.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    # also write to public for dashboard
    pub = PROJECT / 'public' / 'backtest-results.json'
    # combine with phase1 in the dashboard payload
    try:
        phase1 = json.load(open(PROJECT / 'data' / 'merge_backtest_real' / 'phase1_regime_results.json'))
        payload["phase1_results"] = {"results_6mo": phase1["results_6mo"], "results_full": phase1["results_full"]}
    except Exception:
        pass
    with open(pub, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nResults -> {out}")
    print(f"Static  -> {pub}")


if __name__ == "__main__":
    main()

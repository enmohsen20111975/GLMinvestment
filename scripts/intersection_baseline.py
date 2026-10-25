#!/usr/bin/env python3
"""
Intersection Baseline Comparison
=================================
يبني جدول مقارنة على نفس مجموعة الصفقات المتقاطعة (intersection):
- نفس الأيام
- نفس الأسهم (GLM picks = Momentum picks على نفس اليوم)
- نفس n

النتيجة: مقارنة ندّية (apples-to-apples).

Dataset MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8
"""
from __future__ import annotations
import hashlib
import json
import math
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"
PRICE_HISTORY_DB = PROJECT_ROOT / "db" / "price_history.db"
HARD_CAP = 50.0
BH_DAYS = 20  # holding period for all strategies


def compute_kpis(returns):
    valid = [r for r in returns if r is not None and r != 0]
    n = len(valid)
    if n == 0:
        return {"n": 0, "wr": 0, "pf": 0, "exp": 0, "avg_win": 0, "avg_loss": 0, "max_loss": 0, "max_win": 0}
    wins = [r for r in valid if r > 0]
    losses = [r for r in valid if r < 0]
    gp = sum(wins)
    gl = sum(abs(r) for r in losses)
    pf = gp / gl if gl > 0 else 0
    return {
        "n": n,
        "wr": round(len(wins) / n * 100, 2),
        "pf": round(pf, 4),
        "exp": round(sum(valid) / n, 4),
        "avg_win": round(gp / len(wins), 4) if wins else 0,
        "avg_loss": round(-(gl / len(losses)), 4) if losses else 0,
        "max_loss": round(min(valid), 4) if valid else 0,
        "max_win": round(max(valid), 4) if valid else 0,
    }


def get_price_on_date(conn, ticker, date):
    """آخر close_price <= date."""
    row = conn.execute("""
        SELECT close_price FROM price_history
        WHERE ticker = ? AND date <= ?
        ORDER BY date DESC LIMIT 1
    """, (ticker, date)).fetchone()
    return float(row["close_price"] or 0) if row and row["close_price"] else None


def get_price_after_n_days(conn, ticker, date, n):
    """close_price بعد N أيام تداول."""
    rows = conn.execute("""
        SELECT close_price FROM price_history
        WHERE ticker = ? AND date > ?
        ORDER BY date ASC LIMIT ?
    """, (ticker, date, n)).fetchall()
    if len(rows) < n:
        return None
    return float(rows[n-1]["close_price"] or 0) if rows[n-1]["close_price"] else None


def get_momentum_rank(conn, date, lookback=20):
    """رتّب الأسهم حسب أداء آخر N يوم تداول."""
    rows = conn.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date <= ? AND ticker NOT LIKE '% %' AND LENGTH(ticker) <= 12
    """, (date,)).fetchall()

    momentum = []
    for r in rows:
        ticker = r["ticker"]
        last = get_price_on_date(conn, ticker, date)
        if not last or last <= 0:
            continue
        # سعر قبل lookback يوم
        past_rows = conn.execute("""
            SELECT close_price FROM price_history
            WHERE ticker = ? AND date <= ?
            ORDER BY date DESC LIMIT ?
        """, (ticker, date, lookback + 1)).fetchall()
        if len(past_rows) < lookback + 1:
            continue
        past = float(past_rows[lookback]["close_price"] or 0) if past_rows[lookback]["close_price"] else 0
        if past <= 0:
            continue
        ret = (last - past) / past * 100
        momentum.append((ticker, ret, last))

    momentum.sort(key=lambda x: x[1], reverse=True)
    return momentum


def compute_glm_return(trade):
    """عائد GLM بطريقة TP/SL."""
    entry = trade["entry_price"]
    if not entry or entry <= 0:
        return None
    if trade["hit_target"] == 1 and trade["target_price"] and trade["target_price"] > 0:
        ret = ((trade["target_price"] - entry) / entry) * 100
        return max(-HARD_CAP, min(HARD_CAP, ret))
    if trade["hit_stop"] == 1 and trade["stop_loss"] and trade["stop_loss"] > 0:
        ret = ((trade["stop_loss"] - entry) / entry) * 100
        return max(-HARD_CAP, min(HARD_CAP, ret))
    return None


def main():
    print("=" * 70)
    print("INTERSECTION BASELINE COMPARISON (same n, same dates, same tickers)")
    print("=" * 70)

    # MD5
    with open(PROJECT_ROOT / "data" / "active_databases_20260817_full.zip", "rb") as f:
        md5 = hashlib.md5(f.read()).hexdigest()
    print(f"Dataset MD5: {md5}")
    assert md5 == "0947bdf6c2eff1a75ff8af6c3e576ed8"
    print("MD5: ✅\n")

    # Read predictions (balanced only, clean)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_pred = db_manager.connection(PREDICTIONS_DB, writable=False).__enter__()
    conn_pred.row_factory = sqlite3.Row
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_ph = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
    conn_ph.row_factory = sqlite3.Row

    rows = conn_pred.execute("""
        SELECT id, ticker, persona, morning_bell, prediction_date, entry_price,
               target_price, stop_loss, hit_target, hit_stop, status, outcome_date, market
        FROM predictions
        WHERE morning_bell = 0 OR morning_bell IS NULL
        ORDER BY prediction_date
    """).fetchall()

    # Quality filter + dedup + PIT check
    seen = set()
    glm_trades = []
    for row in rows:
        ticker = str(row["ticker"] or "").strip().upper()
        entry = float(row["entry_price"] or 0)
        pred_date = str(row["prediction_date"] or "")
        if not entry or entry <= 0 or not ticker or " " in ticker or len(ticker) > 12:
            continue
        key = f"{ticker}|{pred_date}|{entry:.4f}"
        if key in seen:
            continue
        seen.add(key)

        # PIT: price exists <= prediction_date
        pit = conn_ph.execute("SELECT COUNT(*) as c FROM price_history WHERE ticker = ? AND date <= ?", (ticker, pred_date)).fetchone()
        if pit["c"] == 0:
            continue

        glm_trades.append({
            "ticker": ticker,
            "prediction_date": pred_date,
            "entry_price": entry,
            "target_price": float(row["target_price"] or 0) if row["target_price"] else None,
            "stop_loss": float(row["stop_loss"] or 0) if row["stop_loss"] else None,
            "hit_target": int(row["hit_target"] or 0),
            "hit_stop": int(row["hit_stop"] or 0),
        })

    print(f"GLM balanced trades (clean): {len(glm_trades)}")

    # Build intersection: for each GLM trade date, find if GLM ticker is in Momentum top-3
    # Also build Random pick for same date
    import random
    random.seed(42)

    intersection = []  # list of {date, glm_ticker, momentum_ticker, random_ticker, entry_price}

    # Group GLM trades by date
    by_date = defaultdict(list)
    for t in glm_trades:
        by_date[t["prediction_date"]].append(t)

    print(f"Unique prediction dates: {len(by_date)}")
    print()

    for date in sorted(by_date.keys()):
        glm_picks = by_date[date]

        # Get momentum ranking for this date
        momentum = get_momentum_rank(conn_ph, date, lookback=20)
        top3_tickers = set(ticker for ticker, _, _ in momentum[:3])

        # Get all eligible tickers for random
        universe = [r["ticker"] for r in conn_ph.execute(
            "SELECT DISTINCT ticker FROM price_history WHERE date <= ? AND ticker NOT LIKE '% %' AND LENGTH(ticker) <= 12",
            (date,)
        ).fetchall()]

        for glm_trade in glm_picks:
            ticker = glm_trade["ticker"]

            # Check: does GLM ticker have BH data?
            bh_exit = get_price_after_n_days(conn_ph, ticker, date, BH_DAYS)
            if bh_exit is None or bh_exit <= 0:
                continue

            # Is GLM ticker in Momentum top-3?
            glm_in_momentum = ticker in top3_tickers

            # Momentum pick: top-1 (best momentum)
            if momentum:
                mom_ticker = momentum[0][0]
                mom_entry = get_price_on_date(conn_ph, mom_ticker, date)
                mom_exit = get_price_after_n_days(conn_ph, mom_ticker, date, BH_DAYS)
                if mom_entry is None or mom_entry <= 0 or mom_exit is None or mom_exit <= 0:
                    mom_entry, mom_exit = None, None
            else:
                mom_ticker, mom_entry, mom_exit = None, None, None

            # Random pick
            if len(universe) >= 2:
                rand_ticker = random.choice(universe)
                rand_entry = get_price_on_date(conn_ph, rand_ticker, date)
                rand_exit = get_price_after_n_days(conn_ph, rand_ticker, date, BH_DAYS)
                if rand_entry is None or rand_entry <= 0 or rand_exit is None or rand_exit <= 0:
                    rand_ticker, rand_entry, rand_exit = None, None, None
            else:
                rand_ticker, rand_entry, rand_exit = None, None, None

            intersection.append({
                "date": date,
                "glm_ticker": ticker,
                "glm_in_momentum_top3": glm_in_momentum,
                "momentum_ticker": mom_ticker,
                "random_ticker": rand_ticker,
                # GLM entry = prediction entry_price
                "glm_entry": glm_trade["entry_price"],
                # Momentum/Random entry = close on prediction_date
                "mom_entry": mom_entry,
                "rand_entry": rand_entry,
                # All exit at BH_DAYS (same exit date for all 3)
                "bh_exit": bh_exit,
                "mom_exit": mom_exit,
                "rand_exit": rand_exit,
                # GLM trade (for TP/SL return)
                "glm_trade": glm_trade,
            })

    print(f"Intersection trades (all 3 strategies have data): {len(intersection)}")
    print()

    # Compute returns for each strategy
    glm_tpsl_returns = []
    glm_bh_returns = []
    momentum_returns = []
    random_returns = []

    for item in intersection:
        # GLM TP/SL (contaminated — entry/target/stop may use future data)
        r = compute_glm_return(item["glm_trade"])
        if r is not None:
            glm_tpsl_returns.append(r)

        # GLM BH (PIT-clean for prices)
        entry = item["glm_entry"]
        exit = item["bh_exit"]
        if entry and entry > 0 and exit and exit > 0:
            ret = ((exit - entry) / entry) * 100
            glm_bh_returns.append(max(-HARD_CAP, min(HARD_CAP, ret)))

        # Momentum BH (same N days)
        if item["mom_entry"] and item["mom_exit"] and item["mom_entry"] > 0 and item["mom_exit"] > 0:
            ret = ((item["mom_exit"] - item["mom_entry"]) / item["mom_entry"]) * 100
            momentum_returns.append(max(-HARD_CAP, min(HARD_CAP, ret)))

        # Random BH (same N days)
        if item["rand_entry"] and item["rand_exit"] and item["rand_entry"] > 0 and item["rand_exit"] > 0:
            ret = ((item["rand_exit"] - item["rand_entry"]) / item["rand_entry"]) * 100
            random_returns.append(max(-HARD_CAP, min(HARD_CAP, ret)))

    # KPIs
    kpi_glm_tpsl = compute_kpis(glm_tpsl_returns)
    kpi_glm_bh = compute_kpis(glm_bh_returns)
    kpi_momentum = compute_kpis(momentum_returns)
    kpi_random = compute_kpis(random_returns)

    # Print table
    print("=" * 70)
    print(f"INTERSECTION TABLE (BH = {BH_DAYS} trading days, same dates, same n)")
    print("=" * 70)
    print()
    print(f"{'Strategy':<35} {'n':>5} {'WR%':>7} {'PF':>7} {'Exp%':>8} {'avg_win':>8} {'avg_loss':>9} {'max_loss':>9}")
    print("-" * 95)
    print(f"{'GLM Selection→BH [PIT-clean]':<35} {kpi_glm_bh['n']:>5} {kpi_glm_bh['wr']:>7} {kpi_glm_bh['pf']:>7} {kpi_glm_bh['exp']:>8} {kpi_glm_bh['avg_win']:>8} {kpi_glm_bh['avg_loss']:>9} {kpi_glm_bh['max_loss']:>9}")
    print(f"{'Momentum top-1→BH [PIT-clean]':<35} {kpi_momentum['n']:>5} {kpi_momentum['wr']:>7} {kpi_momentum['pf']:>7} {kpi_momentum['exp']:>8} {kpi_momentum['avg_win']:>8} {kpi_momentum['avg_loss']:>9} {kpi_momentum['max_loss']:>9}")
    print(f"{'Random→BH [PIT-clean]':<35} {kpi_random['n']:>5} {kpi_random['wr']:>7} {kpi_random['pf']:>7} {kpi_random['exp']:>8} {kpi_random['avg_win']:>8} {kpi_random['avg_loss']:>9} {kpi_random['max_loss']:>9}")
    print(f"{'GLM Fixed TP/SL [CONTAMINATED]':<35} {kpi_glm_tpsl['n']:>5} {kpi_glm_tpsl['wr']:>7} {kpi_glm_tpsl['pf']:>7} {kpi_glm_tpsl['exp']:>8} {kpi_glm_tpsl['avg_win']:>8} {kpi_glm_tpsl['avg_loss']:>9} {kpi_glm_tpsl['max_loss']:>9}")
    print()

    # Also compute: GLM picks that are ALSO in momentum top-3
    glm_in_mom = [item for item in intersection if item["glm_in_momentum_top3"]]
    glm_not_in_mom = [item for item in intersection if not item["glm_in_momentum_top3"]]

    print(f"GLM picks that are ALSO in Momentum top-3: {len(glm_in_mom)} / {len(intersection)} ({len(glm_in_mom)/len(intersection)*100:.1f}%)")
    print(f"GLM picks NOT in Momentum top-3: {len(glm_not_in_mom)} / {len(intersection)} ({len(glm_not_in_mom)/len(intersection)*100:.1f}%)")
    print()

    # Returns for GLM picks NOT in momentum top-3 (GLM's unique selection)
    glm_unique_bh = []
    for item in glm_not_in_mom:
        entry = item["glm_entry"]
        exit = item["bh_exit"]
        if entry and entry > 0 and exit and exit > 0:
            ret = ((exit - entry) / entry) * 100
            glm_unique_bh.append(max(-HARD_CAP, min(HARD_CAP, ret)))

    kpi_glm_unique = compute_kpis(glm_unique_bh)
    print(f"GLM UNIQUE picks (not in Momentum top-3) → BH {BH_DAYS}d:")
    print(f"  n={kpi_glm_unique['n']}, WR={kpi_glm_unique['wr']}%, PF={kpi_glm_unique['pf']}, Exp={kpi_glm_unique['exp']}%, max_loss={kpi_glm_unique['max_loss']}%")
    print()

    # Verdict
    print("=" * 70)
    print("VERDICT (intersection — same n, same dates)")
    print("=" * 70)
    print()

    glm_exp = kpi_glm_bh["exp"]
    mom_exp = kpi_momentum["exp"]
    rand_exp = kpi_random["exp"]
    tpsl_exp = kpi_glm_tpsl["exp"]
    unique_exp = kpi_glm_unique["exp"]

    print(f"1. GLM Selection beats Random?     {'YES' if glm_exp > rand_exp else 'NO'}  (GLM BH={glm_exp}% vs Random={rand_exp}%)")
    print(f"2. GLM Selection beats Momentum?    {'YES' if glm_exp > mom_exp else 'NO'}  (GLM BH={glm_exp}% vs Momentum={mom_exp}%)")
    print(f"3. GLM Unique picks beat Momentum?  {'YES' if unique_exp > mom_exp else 'NO'}  (GLM Unique={unique_exp}% vs Momentum={mom_exp}%)")
    print(f"4. Exit kills selection?            {'YES' if glm_exp > tpsl_exp * 2 else 'UNKNOWN'}  (GLM BH={glm_exp}% vs GLM TP/SL={tpsl_exp}%)")
    print(f"5. GLM picks overlap Momentum top-3? {len(glm_in_mom)/len(intersection)*100:.1f}%")
    print()

    # Save JSON
    report = {
        "task": "INTERSECTION-BASELINE",
        "dataset_md5": md5,
        "bh_days": BH_DAYS,
        "intersection_n": len(intersection),
        "comparison": {
            "glm_bh": {**kpi_glm_bh, "label": "GLM Selection→BH [PIT-clean]"},
            "momentum_bh": {**kpi_momentum, "label": f"Momentum top-1→BH {BH_DAYS}d [PIT-clean]"},
            "random_bh": {**kpi_random, "label": f"Random→BH {BH_DAYS}d [PIT-clean, seed=42]"},
            "glm_tpsl": {**kpi_glm_tpsl, "label": "GLM Fixed TP/SL [CONTAMINATED]"},
            "glm_unique_bh": {**kpi_glm_unique, "label": "GLM Unique picks (not in Momentum top-3)→BH [PIT-clean]"},
        },
        "verdict": {
            "beats_random": glm_exp > rand_exp,
            "beats_momentum": glm_exp > mom_exp,
            "unique_beats_momentum": unique_exp > mom_exp,
            "exit_kills_selection": glm_exp > tpsl_exp * 2,
            "glm_momentum_overlap_pct": round(len(glm_in_mom) / len(intersection) * 100, 1),
        },
        "notes": [
            f"All strategies use BH = {BH_DAYS} trading days.",
            "GLM BH/Momentum/Random use close_price on prediction_date as entry (PIT-clean).",
            "GLM TP/SL uses prediction entry/target/stop (CONTAMINATED — may use future data).",
            "max_loss values are HARD-capped at -50% (not actual market losses).",
            "Intersection = only trades where ALL 3 strategies have price data for the same date.",
            "GLM Unique = GLM picks that are NOT in Momentum top-3 (GLM's independent selection value).",
        ],
    }

    json_path = PROJECT_ROOT / "scripts" / "intersection_baseline_comparison.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"JSON saved: {json_path}")

    conn_pred.close()
    conn_ph.close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
PIT-Clean Backtest + Baseline Challenge
========================================
يبني عينة نظيفة من Look-Ahead Bias ثم يقارن:
GLM vs Random vs Momentum vs Selection→Buy&Hold

قواعد PIT (Point-in-Time):
- الأسعار: فقط شموع <= prediction_date (من price_history.db — هذا مصدر نظيف زمنياً)
- fundamentals: مستبعدة تماماً (كلها ملوّثة بـ future snapshot)
- stocks snapshot: مستبعد تماماً (PE/ROE/RSI من August لقرارات January)
- news: مستبعد (symbol=NULL، لا يمكن التحقق)
- ما يُستخدم: ticker + prediction_date + entry_price + target + stop (من predictions)
  + price_history للأسعار فقط

النتيجة: عينة "price-only PIT-clean" — لا مستقبل فيها.

Dataset MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8
"""
from __future__ import annotations
import hashlib
import json
import math
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"
PRICE_HISTORY_DB = PROJECT_ROOT / "db" / "price_history.db"
HARD_CAP = 50.0

# ============================================================================
# Step 1: Build PIT-clean sample
# ============================================================================

def build_pit_clean_sample():
    """
    يبني عينة نظيفة:
    1. يقرأ predictions (153 raw)
    2. يطبق فلتر الجودة (entry>0, ticker clean, dedup)
    3. يتحقق PIT: لكل prediction، هل price_history لديه بيانات <= prediction_date؟
    4. يستبعد أي prediction ليس له سعر قبل تاريخه (impossible prediction)
    5. يحسب dataset_hash للعينة النظيفة
    """
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_pred = db_manager.connection(PREDICTIONS_DB, writable=False).__enter__()
    conn_pred.row_factory = sqlite3.Row
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_ph = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
    conn_ph.row_factory = sqlite3.Row

    # قرأ كل predictions
    rows = conn_pred.execute("""
        SELECT id, ticker, persona, morning_bell, prediction_date, entry_price,
               target_price, stop_loss, hit_target, hit_stop, status, outcome_date,
               market, signal
        FROM predictions
        ORDER BY prediction_date
    """).fetchall()

    print(f"[PIT] Raw predictions: {len(rows)}")

    # فلتر الجودة + dedup
    seen_keys = set()
    clean_trades = []
    excluded = []
    exclusion_breakdown = defaultdict(int)

    for row in rows:
        ticker = str(row["ticker"] or "").strip().upper()
        entry = float(row["entry_price"] or 0)
        pred_date = str(row["prediction_date"] or "")

        # Quality filter
        if not entry or entry <= 0:
            excluded.append({"ticker": ticker, "date": pred_date, "reason": "entry_price_zero"})
            exclusion_breakdown["entry_price_zero"] += 1
            continue

        if not ticker or " " in ticker or len(ticker) > 12:
            excluded.append({"ticker": ticker, "date": pred_date, "reason": "ticker_invalid"})
            exclusion_breakdown["ticker_invalid"] += 1
            continue

        morning_bell = int(row["morning_bell"] or 0)
        channel = "morning_bell" if morning_bell == 1 else "balanced"
        market = str(row["market"] or "UNKNOWN").upper()
        if market == "UNKNOWN" or not market:
            excluded.append({"ticker": ticker, "date": pred_date, "reason": "market_unknown"})
            exclusion_breakdown["market_unknown"] += 1
            continue

        # Dedup
        dedup_key = f"{ticker}|{pred_date}|{channel}|{entry:.4f}"
        if dedup_key in seen_keys:
            excluded.append({"ticker": ticker, "date": pred_date, "reason": "duplicate"})
            exclusion_breakdown["duplicate"] += 1
            continue
        seen_keys.add(dedup_key)

        # PIT CHECK: هل يوجد سعر <= prediction_date لهذا الـ ticker؟
        pit_check = conn_ph.execute("""
            SELECT COUNT(*) as c FROM price_history
            WHERE ticker = ? AND date <= ?
        """, (ticker, pred_date)).fetchone()

        if pit_check["c"] == 0:
            excluded.append({"ticker": ticker, "date": pred_date, "reason": "no_price_before_prediction"})
            exclusion_breakdown["no_price_before_prediction"] += 1
            continue

        # PIT CHECK: هل entry_price منطقي مقارنة بآخر سعر قبل التوقع؟
        last_price_row = conn_ph.execute("""
            SELECT close_price FROM price_history
            WHERE ticker = ? AND date <= ?
            ORDER BY date DESC LIMIT 1
        """, (ticker, pred_date)).fetchone()

        last_close = float(last_price_row["close_price"] or 0) if last_price_row else 0
        if last_close > 0:
            ratio = entry / last_close
            if ratio > 2.0 or ratio < 0.5:
                # entry_price يختلف بشكل كبير عن آخر سعر — قد يكون ملوّث
                excluded.append({"ticker": ticker, "date": pred_date, "reason": "entry_price_mismatch", "entry": entry, "last_close": last_close})
                exclusion_breakdown["entry_price_mismatch"] += 1
                continue

        clean_trades.append({
            "id": row["id"],
            "ticker": ticker,
            "prediction_date": pred_date,
            "entry_price": entry,
            "target_price": float(row["target_price"] or 0) if row["target_price"] else None,
            "stop_loss": float(row["stop_loss"] or 0) if row["stop_loss"] else None,
            "hit_target": int(row["hit_target"] or 0),
            "hit_stop": int(row["hit_stop"] or 0),
            "status": str(row["status"] or ""),
            "outcome_date": str(row["outcome_date"] or "") if row["outcome_date"] else None,
            "channel": channel,
            "market": market,
            "morning_bell": morning_bell,
        })

    conn_pred.close()
    conn_ph.close()

    n_raw = len(rows)
    n_valid = len(clean_trades)
    n_excluded = len(excluded)

    # Dataset hash
    sample_str = json.dumps(clean_trades, sort_keys=True, default=str)
    dataset_hash = hashlib.sha256(sample_str.encode()).hexdigest()[:16]

    print(f"[PIT] Clean sample: {n_valid} (from {n_raw} raw, {n_excluded} excluded)")
    print(f"[PIT] Exclusion breakdown: {dict(exclusion_breakdown)}")
    print(f"[PIT] Dataset hash: {dataset_hash}")

    return clean_trades, {
        "n_raw": n_raw,
        "n_valid": n_valid,
        "n_excluded": n_excluded,
        "exclusion_breakdown": dict(exclusion_breakdown),
        "dataset_hash": dataset_hash,
        "pit_rules": [
            "Prices: only candles <= prediction_date (from price_history.db)",
            "Fundamentals: EXCLUDED (all contaminated by future snapshot)",
            "Stocks snapshot: EXCLUDED (PE/ROE/RSI from August for January predictions)",
            "News: EXCLUDED (symbol=NULL, cannot verify per-ticker)",
            "Used: ticker + prediction_date + entry_price + target + stop (from predictions table)",
            "PIT check: each prediction must have price data <= prediction_date",
            "PIT check: entry_price must be within 0.5x-2.0x of last close before prediction",
        ],
    }


# ============================================================================
# Step 2: Compute returns
# ============================================================================

def compute_glm_return(trade):
    """حساب عائد GLM بطريقة TP/SL (الطريقة الحالية)."""
    entry = trade["entry_price"]
    if not entry or entry <= 0:
        return None

    if trade["hit_target"] == 1 and trade["target_price"] and trade["target_price"] > 0:
        ret = ((trade["target_price"] - entry) / entry) * 100
        return max(-HARD_CAP, min(HARD_CAP, ret))

    if trade["hit_stop"] == 1 and trade["stop_loss"] and trade["stop_loss"] > 0:
        ret = ((trade["stop_loss"] - entry) / entry) * 100
        return max(-HARD_CAP, min(HARD_CAP, ret))

    return None  # expired no hit


def compute_buy_hold_return(trade, days, conn_ph):
    """حساب عائد Buy&Hold: entry → close after N trading days."""
    entry = trade["entry_price"]
    if not entry or entry <= 0:
        return None

    ticker = trade["ticker"]
    pred_date = trade["prediction_date"]

    rows = conn_ph.execute("""
        SELECT close_price FROM price_history
        WHERE ticker = ? AND date > ?
        ORDER BY date ASC LIMIT ?
    """, (ticker, pred_date, days)).fetchall()

    if len(rows) < days:
        return None

    exit_price = float(rows[days - 1]["close_price"] or 0)
    if exit_price <= 0:
        return None

    ret = ((exit_price - entry) / entry) * 100
    return max(-HARD_CAP, min(HARD_CAP, ret))


# ============================================================================
# Step 3: Baselines
# ============================================================================

def get_universe_for_date(date, conn_ph):
    """كل الأسهم EGX التي لها سعر <= date."""
    rows = conn_ph.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date <= ? AND ticker NOT LIKE '% %' AND LENGTH(ticker) <= 12
    """, (date,)).fetchall()
    return [r["ticker"] for r in rows]


def get_momentum_rank(date, conn_ph, lookback=20):
    """رتّب الأسهم حسب أداء آخر N يوم."""
    rows = conn_ph.execute("""
        SELECT ticker,
               (SELECT close_price FROM price_history p2
                WHERE p2.ticker = p1.ticker AND p2.date <= ?
                ORDER BY p2.date DESC LIMIT 1) as last_close,
               (SELECT close_price FROM price_history p3
                WHERE p3.ticker = p1.ticker AND p3.date <= ?
                ORDER BY p3.date DESC LIMIT 1 OFFSET 19) as past_close
        FROM (SELECT DISTINCT ticker FROM price_history
              WHERE date <= ? AND ticker NOT LIKE '% %' AND LENGTH(ticker) <= 12) p1
    """, (date, date, date)).fetchall()

    momentum = []
    for r in rows:
        last = float(r["last_close"] or 0) if r["last_close"] else 0
        past = float(r["past_close"] or 0) if r["past_close"] else 0
        if last > 0 and past > 0:
            ret = (last - past) / past * 100
            momentum.append((r["ticker"], ret))

    momentum.sort(key=lambda x: x[1], reverse=True)
    return momentum


def compute_kpis(returns):
    """احسب KPIs من قائمة عوائد."""
    valid = [r for r in returns if r is not None and r != 0]
    n = len(valid)
    if n == 0:
        return {"n": 0, "wr": 0, "pf": 0, "exp": 0, "avg_win": 0, "avg_loss": 0, "max_loss": 0, "max_win": 0}

    wins = [r for r in valid if r > 0]
    losses = [r for r in valid if r < 0]

    gross_profit = sum(wins)
    gross_loss = sum(abs(r) for r in losses)
    pf = gross_profit / gross_loss if gross_loss > 0 else 0

    avg_win = gross_profit / len(wins) if wins else 0
    avg_loss = -(gross_loss / len(losses)) if losses else 0
    exp = sum(valid) / n
    max_loss = min(valid) if valid else 0
    max_win = max(valid) if valid else 0

    return {
        "n": n,
        "wr": round(len(wins) / n * 100, 2),
        "pf": round(pf, 4),
        "exp": round(exp, 4),
        "avg_win": round(avg_win, 4),
        "avg_loss": round(avg_loss, 4),
        "max_loss": round(max_loss, 4),
        "max_win": round(max_win, 4),
    }


# ============================================================================
# Main
# ============================================================================

def main():
    print("=" * 60)
    print("PIT-CLEAN BACKTEST + BASELINE CHALLENGE")
    print("=" * 60)

    # Verify MD5
    import hashlib as hl
    with open(PROJECT_ROOT / "data" / "active_databases_20260817_full.zip", "rb") as f:
        md5 = hl.md5(f.read()).hexdigest()
    print(f"Dataset MD5: {md5}")
    assert md5 == "0947bdf6c2eff1a75ff8af6c3e576ed8", "MD5 MISMATCH!"
    print("MD5: ✅ VERIFIED")
    print()

    # Step 1: Build PIT-clean sample
    trades, sample_info = build_pit_clean_sample()
    print()

    # Split by channel
    balanced = [t for t in trades if t["channel"] == "balanced"]
    morning_bell = [t for t in trades if t["channel"] == "morning_bell"]
    print(f"Channels: balanced={len(balanced)}, morning_bell={len(morning_bell)}")
    print()

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_ph = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
    conn_ph.row_factory = sqlite3.Row

    # Step 2: GLM returns (TP/SL method)
    print("--- GLM Plan Exit (Fixed TP/SL) ---")
    glm_returns_all = [compute_glm_return(t) for t in trades]
    glm_returns_balanced = [compute_glm_return(t) for t in balanced]
    glm_returns_mb = [compute_glm_return(t) for t in morning_bell]

    kpi_glm_all = compute_kpis(glm_returns_all)
    kpi_glm_balanced = compute_kpis(glm_returns_balanced)
    kpi_glm_mb = compute_kpis(glm_returns_mb)

    print(f"ALL: n={kpi_glm_all['n']}, WR={kpi_glm_all['wr']}%, PF={kpi_glm_all['pf']}, Exp={kpi_glm_all['exp']}%")
    print(f"balanced: n={kpi_glm_balanced['n']}, WR={kpi_glm_balanced['wr']}%, PF={kpi_glm_balanced['pf']}, Exp={kpi_glm_balanced['exp']}%")
    print(f"morning_bell: n={kpi_glm_mb['n']}, WR={kpi_glm_mb['wr']}%, PF={kpi_glm_mb['pf']}, Exp={kpi_glm_mb['exp']}%")
    print()

    # Step 3: Selection→Buy&Hold (10/20/30 days)
    print("--- Selection→Buy&Hold (same picks, no TP/SL) ---")
    bh_returns = {10: [], 20: [], 30: []}
    for t in balanced:  # balanced only for clean comparison
        for days in [10, 20, 30]:
            r = compute_buy_hold_return(t, days, conn_ph)
            bh_returns[days].append(r)

    kpi_bh = {d: compute_kpis(bh_returns[d]) for d in [10, 20, 30]}
    for d in [10, 20, 30]:
        k = kpi_bh[d]
        print(f"BH {d}d: n={k['n']}, WR={k['wr']}%, PF={k['pf']}, Exp={k['exp']}%, max_loss={k['max_loss']}%")
    print()

    # Step 4: Random baseline (same dates, same N, random tickers)
    print("--- Random Selection (Monte Carlo) ---")
    import random
    random.seed(42)  # reproducible

    n_trials = min(len(balanced), 100)  # match GLM balanced sample size
    mc_returns = []

    # For each GLM prediction date, pick a random eligible stock
    all_dates = list(set(t["prediction_date"] for t in balanced))
    for pred_date in all_dates:
        universe = get_universe_for_date(pred_date, conn_ph)
        if len(universe) < 2:
            continue

        # Pick random stock
        random_ticker = random.choice(universe)

        # Get entry price = close on pred_date
        entry_row = conn_ph.execute("""
            SELECT close_price FROM price_history
            WHERE ticker = ? AND date <= ?
            ORDER BY date DESC LIMIT 1
        """, (random_ticker, pred_date)).fetchone()

        if not entry_row or not entry_row["close_price"]:
            continue
        entry = float(entry_row["close_price"])

        # Exit after 20 trading days
        exit_rows = conn_ph.execute("""
            SELECT close_price FROM price_history
            WHERE ticker = ? AND date > ?
            ORDER BY date ASC LIMIT 20
        """, (random_ticker, pred_date)).fetchall()

        if len(exit_rows) < 20:
            continue
        exit_price = float(exit_rows[19]["close_price"] or 0)
        if exit_price <= 0:
            continue

        ret = ((exit_price - entry) / entry) * 100
        mc_returns.append(max(-HARD_CAP, min(HARD_CAP, ret)))

    kpi_random = compute_kpis(mc_returns)
    print(f"Random: n={kpi_random['n']}, WR={kpi_random['wr']}%, PF={kpi_random['pf']}, Exp={kpi_random['exp']}%")
    print()

    # Step 5: Momentum baseline (top-3 by 20-day return)
    print("--- Momentum (top-3 by 20-day return) ---")
    mom_returns = []

    for pred_date in all_dates:
        momentum = get_momentum_rank(pred_date, conn_ph, lookback=20)
        top3 = momentum[:3]

        for ticker, mom_score in top3:
            # Entry = close on pred_date
            entry_row = conn_ph.execute("""
                SELECT close_price FROM price_history
                WHERE ticker = ? AND date <= ?
                ORDER BY date DESC LIMIT 1
            """, (ticker, pred_date)).fetchone()

            if not entry_row or not entry_row["close_price"]:
                continue
            entry = float(entry_row["close_price"])

            # Exit after 20 trading days
            exit_rows = conn_ph.execute("""
                SELECT close_price FROM price_history
                WHERE ticker = ? AND date > ?
                ORDER BY date ASC LIMIT 20
            """, (ticker, pred_date)).fetchall()

            if len(exit_rows) < 20:
                continue
            exit_price = float(exit_rows[19]["close_price"] or 0)
            if exit_price <= 0:
                continue

            ret = ((exit_price - entry) / entry) * 100
            mom_returns.append(max(-HARD_CAP, min(HARD_CAP, ret)))

    kpi_momentum = compute_kpis(mom_returns)
    print(f"Momentum: n={kpi_momentum['n']}, WR={kpi_momentum['wr']}%, PF={kpi_momentum['pf']}, Exp={kpi_momentum['exp']}%")
    print()

    conn_ph.close()

    # Step 6: Build comparison table
    print("=" * 60)
    print("PIT-CLEAN COMPARISON TABLE (balanced channel only)")
    print("=" * 60)
    print()
    print(f"{'Strategy':<30} {'n':>5} {'WR%':>7} {'PF':>7} {'Exp%':>8} {'avg_win':>8} {'avg_loss':>9} {'max_loss':>9}")
    print("-" * 90)
    print(f"{'GLM (Fixed TP/SL) [CONTAM.]':<30} {kpi_glm_balanced['n']:>5} {kpi_glm_balanced['wr']:>7} {kpi_glm_balanced['pf']:>7} {kpi_glm_balanced['exp']:>8} {kpi_glm_balanced['avg_win']:>8} {kpi_glm_balanced['avg_loss']:>9} {kpi_glm_balanced['max_loss']:>9}")
    print(f"{'GLM Selection→BH 10d':<30} {kpi_bh[10]['n']:>5} {kpi_bh[10]['wr']:>7} {kpi_bh[10]['pf']:>7} {kpi_bh[10]['exp']:>8} {kpi_bh[10]['avg_win']:>8} {kpi_bh[10]['avg_loss']:>9} {kpi_bh[10]['max_loss']:>9}")
    print(f"{'GLM Selection→BH 20d':<30} {kpi_bh[20]['n']:>5} {kpi_bh[20]['wr']:>7} {kpi_bh[20]['pf']:>7} {kpi_bh[20]['exp']:>8} {kpi_bh[20]['avg_win']:>8} {kpi_bh[20]['avg_loss']:>9} {kpi_bh[20]['max_loss']:>9}")
    print(f"{'GLM Selection→BH 30d':<30} {kpi_bh[30]['n']:>5} {kpi_bh[30]['wr']:>7} {kpi_bh[30]['pf']:>7} {kpi_bh[30]['exp']:>8} {kpi_bh[30]['avg_win']:>8} {kpi_bh[30]['avg_loss']:>9} {kpi_bh[30]['max_loss']:>9}")
    print(f"{'Random (BH 20d, seed=42)':<30} {kpi_random['n']:>5} {kpi_random['wr']:>7} {kpi_random['pf']:>7} {kpi_random['exp']:>8} {kpi_random['avg_win']:>8} {kpi_random['avg_loss']:>9} {kpi_random['max_loss']:>9}")
    print(f"{'Momentum (top-3, BH 20d)':<30} {kpi_momentum['n']:>5} {kpi_momentum['wr']:>7} {kpi_momentum['pf']:>7} {kpi_momentum['exp']:>8} {kpi_momentum['avg_win']:>8} {kpi_momentum['avg_loss']:>9} {kpi_momentum['max_loss']:>9}")
    print()

    # Verdict
    print("=" * 60)
    print("VERDICT")
    print("=" * 60)
    glm_exp = kpi_glm_balanced["exp"]
    bh20_exp = kpi_bh[20]["exp"]
    random_exp = kpi_random["exp"]
    mom_exp = kpi_momentum["exp"]

    print(f"GLM beats Random?    {'YES' if glm_exp > random_exp else 'NO'} (GLM={glm_exp}% vs Random={random_exp}%)")
    print(f"GLM beats Momentum?  {'YES' if glm_exp > mom_exp else 'NO'} (GLM={glm_exp}% vs Momentum={mom_exp}%)")
    print(f"Exit kills selection? {'YES' if bh20_exp > glm_exp * 1.5 else 'NO'} (GLM={glm_exp}% vs BH20d={bh20_exp}%)")
    print()

    # Build report JSON
    report = {
        "task": "PIT-CLEAN-BASELINE-CHALLENGE",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "dataset_md5": md5,
        "sample_info": sample_info,
        "comparison_table": {
            "glm_fixed_tpsl": {**kpi_glm_balanced, "label": "GLM (Fixed TP/SL) [CONTAMINATED — entry/target/stop may use future data]"},
            "glm_selection_bh_10d": {**kpi_bh[10], "label": "GLM Selection→BH 10d [PIT-clean for prices]"},
            "glm_selection_bh_20d": {**kpi_bh[20], "label": "GLM Selection→BH 20d [PIT-clean for prices]"},
            "glm_selection_bh_30d": {**kpi_bh[30], "label": "GLM Selection→BH 30d [PIT-clean for prices]"},
            "random_bh_20d": {**kpi_random, "label": "Random (BH 20d, seed=42) [PIT-clean]"},
            "momentum_top3_bh_20d": {**kpi_momentum, "label": "Momentum top-3 (BH 20d) [PIT-clean]"},
        },
        "verdict": {
            "beats_random": glm_exp > random_exp,
            "beats_momentum": glm_exp > mom_exp,
            "exit_kills_selection": bh20_exp > glm_exp * 1.5,
            "glm_exp": glm_exp,
            "bh20_exp": bh20_exp,
            "random_exp": random_exp,
            "momentum_exp": mom_exp,
        },
        "important_notes": [
            "GLM Fixed TP/SL numbers are CONTAMINATED — entry/target/stop may have been computed using future data",
            "Selection→BH and Random and Momentum use ONLY price_history (PIT-clean for prices)",
            "Fundamentals are EXCLUDED entirely (all contaminated)",
            "Stocks snapshot (PE/ROE/RSI) EXCLUDED (August data for January predictions)",
            "The selection itself (which ticker to pick) may still be contaminated by retroactive generation",
            "This is the best available PIT-clean comparison given dataset limitations",
        ],
    }

    # Save JSON
    json_path = PROJECT_ROOT / "scripts" / "pit_clean_baseline_comparison.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"JSON saved: {json_path}")

    # Print final certificate
    print()
    print("=" * 60)
    print("FINAL CERTIFICATE")
    print("=" * 60)
    print(f"EDGE_STATUS: UNPROVEN")
    print(f"DATASET_MD5: {md5}")
    print(f"SAMPLE_HASH: {sample_info['dataset_hash']}")
    print(f"PIT_RULES: price-only (fundamentals/stocks/news excluded)")
    print(f"BEATS_RANDOM: {'YES' if glm_exp > random_exp else 'NO'} (GLM={glm_exp}% vs Random={random_exp}%)")
    print(f"BEATS_MOMENTUM: {'YES' if glm_exp > mom_exp else 'NO'} (GLM={glm_exp}% vs Momentum={mom_exp}%)")
    print(f"EXIT_KILLS_SELECTION: {'YES' if bh20_exp > glm_exp * 1.5 else 'UNKNOWN'} (GLM={glm_exp}% vs BH20d={bh20_exp}%)")
    print(f"NOTE: GLM TP/SL numbers are CONTAMINATED. BH/Random/Momentum are PIT-clean for prices.")
    print(f"NOTE: Selection itself may still be contaminated (retroactive generation).")


if __name__ == "__main__":
    main()

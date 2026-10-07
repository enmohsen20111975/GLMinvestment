#!/usr/bin/env python3
"""
Walk-Forward Live Simulation
=============================
محاكاة تداول حي على البيانات التاريخية — تحاكي التداول الحي خطوة بخطوة.

المنطق:
1. لكل يوم تداول D فيه توصيات:
   - اقرأ التوصيات المتاحة فقط (prediction_date = D)
   -_filtrel: balanced فقط، entry > 0، ticker نظيف، dedup
2. لكل توصية: افتح صفقة عند entry_price
3. من D+1 فصاعداً: تتبع السعر يومياً (من price_history.db):
   - لو low <= stop_loss → اغلق عند stop_loss (SL)
   - لو high >= target_price → اغلق عند target_price (TP)
   - لو انتهت 20 يوم تداول → اغلق عند close (time_expiry)
4. سجل MFE/MAE لكل صفقة
5. احسب KPIs على النتائج

الفرق عن الباك تست القديم:
- القديم: يقرأ hit_target/hit_stop (متحسبة ببيانات مستقبلية)
- هذا: يحاكي الخروج بأسعار يومية فعلية (لا مستقبل)

Dataset MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8
"""
from __future__ import annotations
import hashlib
import json
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"
PRICE_HISTORY_DB = PROJECT_ROOT / "db" / "price_history.db"
HARD_CAP = 50.0
MAX_HOLDING_DAYS = 20  # تجربة: 20 يوم تداول


def compute_kpis(trades):
    """احسب KPIs من قائمة صفقات مغلقة."""
    valid = [t for t in trades if t["return_pct"] is not None]
    n = len(valid)
    if n == 0:
        return {"n": 0, "wr": 0, "pf": 0, "exp": 0, "avg_win": 0, "avg_loss": 0, "max_loss": 0, "max_win": 0}

    returns = [t["return_pct"] for t in valid]
    wins = [r for r in returns if r > 0]
    losses = [r for r in returns if r < 0]

    gp = sum(wins)
    gl = sum(abs(r) for r in losses)
    pf = gp / gl if gl > 0 else 0

    avg_win = gp / len(wins) if wins else 0
    avg_loss = -(gl / len(losses)) if losses else 0
    exp = sum(returns) / n
    max_loss = min(returns) if returns else 0
    max_win = max(returns) if returns else 0

    # Exit reason breakdown
    exit_reasons = defaultdict(int)
    for t in valid:
        exit_reasons[t["exit_reason"]] += 1

    # MFE/MAE averages
    mfe_avg = sum(t["mfe_pct"] for t in valid) / n if n > 0 else 0
    mae_avg = sum(t["mae_pct"] for t in valid) / n if n > 0 else 0

    return {
        "n": n,
        "wr": round(len(wins) / n * 100, 2),
        "pf": round(pf, 4),
        "exp": round(exp, 4),
        "avg_win": round(avg_win, 4),
        "avg_loss": round(avg_loss, 4),
        "max_loss": round(max_loss, 4),
        "max_win": round(max_win, 4),
        "tp_hit": exit_reasons.get("TP", 0),
        "sl_hit": exit_reasons.get("SL", 0),
        "time_expiry": exit_reasons.get("TIME_EXPIRY", 0),
        "mfe_avg": round(mfe_avg, 4),
        "mae_avg": round(mae_avg, 4),
    }


def simulate_walk_forward(channel="balanced", holding_days=MAX_HOLDING_DAYS):
    """
    محاكاة Walk-Forward:
    1. لكل يوم فيه توصيات (balanced): افتح صفقات
    2. تتبع الأسعار اليومية من price_history
    3. اغلق عند TP / SL / انتهاء مدة
    4. سجل MFE/MAE
    """
    conn_pred = sqlite3.connect(f"file:{PREDICTIONS_DB}?mode=ro", uri=True)
    conn_pred.row_factory = sqlite3.Row
    conn_ph = sqlite3.connect(f"file:{PRICE_HISTORY_DB}?mode=ro", uri=True)
    conn_ph.row_factory = sqlite3.Row

    # اقرأ التوصيات (balanced فقط)
    if channel == "balanced":
        rows = conn_pred.execute("""
            SELECT id, ticker, prediction_date, entry_price, target_price, stop_loss,
                   morning_bell, market
            FROM predictions
            WHERE (morning_bell = 0 OR morning_bell IS NULL)
              AND entry_price > 0
            ORDER BY prediction_date
        """).fetchall()
    else:  # morning_bell
        rows = conn_pred.execute("""
            SELECT id, ticker, prediction_date, entry_price, target_price, stop_loss,
                   morning_bell, market
            FROM predictions
            WHERE morning_bell = 1
              AND entry_price > 0
            ORDER BY prediction_date
        """).fetchall()

    # Quality filter + dedup
    seen = set()
    trades = []
    for row in rows:
        ticker = str(row["ticker"] or "").strip().upper()
        entry = float(row["entry_price"] or 0)
        pred_date = str(row["prediction_date"] or "")

        if not ticker or " " in ticker or len(ticker) > 12:
            continue
        if not entry or entry <= 0:
            continue

        key = f"{ticker}|{pred_date}|{entry:.4f}"
        if key in seen:
            continue
        seen.add(key)

        target = float(row["target_price"] or 0) if row["target_price"] else None
        stop = float(row["stop_loss"] or 0) if row["stop_loss"] else None

        if not target or target <= 0 or not stop or stop <= 0:
            continue  # Skip trades without TP/SL

        trades.append({
            "signal_id": row["id"],
            "ticker": ticker,
            "prediction_date": pred_date,
            "entry_price": entry,
            "target_price": target,
            "stop_loss": stop,
            "market": str(row["market"] or "EGX"),
        })

    print(f"[Walk-Forward] {channel}: {len(trades)} clean trades (from {len(rows)} raw)")
    print(f"[Walk-Forward] Holding period: {holding_days} trading days")
    print()

    # Simulate each trade
    results = []
    for trade in trades:
        ticker = trade["ticker"]
        pred_date = trade["prediction_date"]
        entry = trade["entry_price"]
        target = trade["target_price"]
        stop = trade["stop_loss"]

        # Get daily prices AFTER prediction_date
        daily_prices = conn_ph.execute("""
            SELECT date, open_price, high_price, low_price, close_price
            FROM price_history
            WHERE ticker = ? AND date > ?
            ORDER BY date ASC LIMIT ?
        """, (ticker, pred_date, holding_days)).fetchall()

        if len(daily_prices) == 0:
            # No price data after prediction — skip
            continue

        # Simulate day by day
        mfe_price = entry  # highest price reached
        mae_price = entry  # lowest price reached
        exit_price = None
        exit_reason = None
        exit_date = None
        holding_days_actual = 0

        for i, day in enumerate(daily_prices):
            holding_days_actual = i + 1
            day_high = float(day["high_price"] or 0) if day["high_price"] else 0
            day_low = float(day["low_price"] or 0) if day["low_price"] else 0
            day_close = float(day["close_price"] or 0) if day["close_price"] else 0
            day_date = str(day["date"])

            if day_high <= 0 or day_low <= 0:
                continue

            # Update MFE/MAE
            mfe_price = max(mfe_price, day_high)
            mae_price = min(mae_price, day_low)

            # Check exits (SL first — conservative: if both hit same day, assume SL first)
            if day_low <= stop:
                exit_price = stop
                exit_reason = "SL"
                exit_date = day_date
                break

            if day_high >= target:
                exit_price = target
                exit_reason = "TP"
                exit_date = day_date
                break

            # Time expiry
            if i == holding_days - 1:
                exit_price = day_close
                exit_reason = "TIME_EXPIRY"
                exit_date = day_date
                break

        if exit_price is None:
            # Ran out of price data before any exit
            if len(daily_prices) > 0:
                last = daily_prices[-1]
                exit_price = float(last["close_price"] or 0) if last["close_price"] else entry
                exit_reason = "DATA_END"
                exit_date = str(last["date"])
            else:
                continue

        # Calculate return
        if exit_price and exit_price > 0 and entry and entry > 0:
            return_pct = ((exit_price - entry) / entry) * 100
            return_pct = max(-HARD_CAP, min(HARD_CAP, return_pct))
        else:
            return_pct = 0

        # MFE/MAE percentages
        mfe_pct = ((mfe_price - entry) / entry) * 100 if entry > 0 else 0
        mae_pct = ((mae_price - entry) / entry) * 100 if entry > 0 else 0

        results.append({
            "signal_id": trade["signal_id"],
            "ticker": ticker,
            "prediction_date": pred_date,
            "entry_price": round(entry, 4),
            "target_price": round(target, 4),
            "stop_loss": round(stop, 4),
            "exit_price": round(exit_price, 4),
            "exit_reason": exit_reason,
            "exit_date": exit_date,
            "return_pct": round(return_pct, 4),
            "mfe_pct": round(mfe_pct, 4),
            "mae_pct": round(mae_pct, 4),
            "holding_days": holding_days_actual,
            "channel": channel,
        })

    conn_pred.close()
    conn_ph.close()

    return results


def main():
    print("=" * 70)
    print("WALK-FORWARD LIVE SIMULATION")
    print("(Simulates real trading day-by-day — no future data)")
    print("=" * 70)

    # MD5
    with open(PROJECT_ROOT / "data" / "active_databases_20260817_full.zip", "rb") as f:
        md5 = hashlib.md5(f.read()).hexdigest()
    print(f"Dataset MD5: {md5}")
    assert md5 == "0947bdf6c2eff1a75ff8af6c3e576ed8"
    print("MD5: ✅\n")

    # Simulate balanced
    print("--- BALANCED channel ---")
    balanced_results = simulate_walk_forward("balanced", MAX_HOLDING_DAYS)
    kpi_balanced = compute_kpis(balanced_results)

    print(f"Trades simulated: {len(balanced_results)}")
    print(f"  TP hits: {kpi_balanced['tp_hit']} | SL hits: {kpi_balanced['sl_hit']} | Time expiry: {kpi_balanced['time_expiry']}")
    print(f"  n={kpi_balanced['n']}, WR={kpi_balanced['wr']}%, PF={kpi_balanced['pf']}, Exp={kpi_balanced['exp']}%")
    print(f"  avg_win={kpi_balanced['avg_win']}%, avg_loss={kpi_balanced['avg_loss']}%")
    print(f"  max_loss={kpi_balanced['max_loss']}%, max_win={kpi_balanced['max_win']}%")
    print(f"  MFE avg={kpi_balanced['mfe_avg']}%, MAE avg={kpi_balanced['mae_avg']}%")
    print()

    # Simulate morning_bell (quarantined — for reference only)
    print("--- MORNING_BELL channel (QUARANTINED — reference only) ---")
    mb_results = simulate_walk_forward("morning_bell", MAX_HOLDING_DAYS)
    kpi_mb = compute_kpis(mb_results)

    print(f"Trades simulated: {len(mb_results)}")
    print(f"  TP hits: {kpi_mb['tp_hit']} | SL hits: {kpi_mb['sl_hit']} | Time expiry: {kpi_mb['time_expiry']}")
    print(f"  n={kpi_mb['n']}, WR={kpi_mb['wr']}%, PF={kpi_mb['pf']}, Exp={kpi_mb['exp']}%")
    print()

    # Also simulate Buy&Hold for comparison (same trades, no TP/SL)
    print("--- COMPARISON: GLM Selection→BH (same picks, no TP/SL) ---")
    bh_returns = []
    for t in balanced_results:
        bh_returns.append({
            "return_pct": t["return_pct"] if t["exit_reason"] == "TIME_EXPIRY" else None,
            "exit_reason": "BH",
            "mfe_pct": t["mfe_pct"],
            "mae_pct": t["mae_pct"],
        })
    # For BH: use the close price at holding_days (not TP/SL)
    # Actually we need to recompute: for BH, exit at day 20 close regardless
    conn_ph = sqlite3.connect(f"file:{PRICE_HISTORY_DB}?mode=ro", uri=True)
    conn_ph.row_factory = sqlite3.Row
    bh_returns_clean = []
    for t in balanced_results:
        rows = conn_ph.execute("""
            SELECT close_price FROM price_history
            WHERE ticker = ? AND date > ?
            ORDER BY date ASC LIMIT ?
        """, (t["ticker"], t["prediction_date"], MAX_HOLDING_DAYS)).fetchall()
        if len(rows) >= MAX_HOLDING_DAYS:
            close = float(rows[MAX_HOLDING_DAYS - 1]["close_price"] or 0)
            if close > 0 and t["entry_price"] > 0:
                ret = ((close - t["entry_price"]) / t["entry_price"]) * 100
                ret = max(-HARD_CAP, min(HARD_CAP, ret))
                bh_returns_clean.append({
                    "return_pct": ret,
                    "exit_reason": "BH",
                    "mfe_pct": t["mfe_pct"],
                    "mae_pct": t["mae_pct"],
                })
    conn_ph.close()

    kpi_bh = compute_kpis(bh_returns_clean)
    print(f"  n={kpi_bh['n']}, WR={kpi_bh['wr']}%, PF={kpi_bh['pf']}, Exp={kpi_bh['exp']}%")
    print(f"  avg_win={kpi_bh['avg_win']}%, avg_loss={kpi_bh['avg_loss']}%")
    print(f"  max_loss={kpi_bh['max_loss']}%, max_win={kpi_bh['max_win']}%")
    print()

    # Final comparison table
    print("=" * 70)
    print("FINAL COMPARISON TABLE (Walk-Forward, day-by-day simulation)")
    print("=" * 70)
    print()
    print(f"{'Strategy':<35} {'n':>5} {'WR%':>7} {'PF':>7} {'Exp%':>8} {'avg_win':>8} {'avg_loss':>9} {'max_loss':>9} {'TP':>4} {'SL':>4} {'Exp':>4}")
    print("-" * 105)
    print(f"{'GLM Walk-Forward (TP/SL) [PIT]':<35} {kpi_balanced['n']:>5} {kpi_balanced['wr']:>7} {kpi_balanced['pf']:>7} {kpi_balanced['exp']:>8} {kpi_balanced['avg_win']:>8} {kpi_balanced['avg_loss']:>9} {kpi_balanced['max_loss']:>9} {kpi_balanced['tp_hit']:>4} {kpi_balanced['sl_hit']:>4} {kpi_balanced['time_expiry']:>4}")
    print(f"{'GLM Selection→BH 20d [PIT]':<35} {kpi_bh['n']:>5} {kpi_bh['wr']:>7} {kpi_bh['pf']:>7} {kpi_bh['exp']:>8} {kpi_bh['avg_win']:>8} {kpi_bh['avg_loss']:>9} {kpi_bh['max_loss']:>9} {'—':>4} {'—':>4} {kpi_bh['n']:>4}")
    print()

    # Verdict
    print("=" * 70)
    print("VERDICT")
    print("=" * 70)
    glm_exp = kpi_balanced["exp"]
    bh_exp = kpi_bh["exp"]
    print(f"1. GLM Walk-Forward PF > 1?    {'YES' if kpi_balanced['pf'] > 1 else 'NO'}  (PF={kpi_balanced['pf']})")
    print(f"2. Exit kills selection?       {'YES' if bh_exp > glm_exp * 1.5 else 'NO'}  (GLM={glm_exp}% vs BH={bh_exp}%)")
    print(f"3. TP hit rate:                {kpi_balanced['tp_hit']}/{kpi_balanced['n']} = {round(kpi_balanced['tp_hit']/max(kpi_balanced['n'],1)*100,1)}%")
    print(f"4. SL hit rate:                {kpi_balanced['sl_hit']}/{kpi_balanced['n']} = {round(kpi_balanced['sl_hit']/max(kpi_balanced['n'],1)*100,1)}%")
    print(f"5. Time expiry rate:           {kpi_balanced['time_expiry']}/{kpi_balanced['n']} = {round(kpi_balanced['time_expiry']/max(kpi_balanced['n'],1)*100,1)}%")
    print(f"6. Avg MFE (favorable):       +{kpi_balanced['mfe_avg']}% (how much profit was available)")
    print(f"7. Avg MAE (adverse):          {kpi_balanced['mae_avg']}% (how much drawdown was endured)")
    print()

    # Key insight
    if kpi_balanced["mfe_avg"] > abs(kpi_balanced["exp"]) * 2:
        print(f"⚠️  MFE avg ({kpi_balanced['mfe_avg']}%) >> Exp ({kpi_balanced['exp']}%)")
        print(f"   → The market gave {kpi_balanced['mfe_avg']}% profit on average,")
        print(f"     but the system only captured {kpi_balanced['exp']}%.")
        print(f"     → EXIT LOGIC IS LEAVING MONEY ON THE TABLE.")
    print()

    # Save JSON
    report = {
        "task": "WALK-FORWARD-SIMULATION",
        "dataset_md5": md5,
        "holding_days": MAX_HOLDING_DAYS,
        "method": "Day-by-day simulation: read prediction → open at entry → track daily OHLC → exit at SL/TP/time_expiry",
        "pit_note": "Prices are PIT-clean (only uses price_history <= decision date). Entry/target/stop from predictions may still be contaminated by retroactive generation.",
        "balanced": {**kpi_balanced, "trades": balanced_results[:20]},  # Top 20 for display
        "morning_bell": {**kpi_mb, "trades": mb_results[:20]},
        "buy_hold_comparison": {**kpi_bh},
        "verdict": {
            "glm_pf_gt_1": kpi_balanced["pf"] > 1,
            "exit_kills_selection": bh_exp > glm_exp * 1.5,
            "mfe_vs_exp_ratio": round(kpi_balanced["mfe_avg"] / max(abs(kpi_balanced["exp"]), 0.01), 2),
        },
    }

    json_path = PROJECT_ROOT / "scripts" / "walk_forward_simulation.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"JSON saved: {json_path}")


if __name__ == "__main__":
    main()

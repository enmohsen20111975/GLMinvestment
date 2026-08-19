#!/usr/bin/env python3
"""
Morning Bell Measurement Corrections (P41-HIST-CORR)
====================================================
تصحيحات القياس الخمسة لجرس الصباح بناءً على مراجعة المالك.

التصحيحات:
  1. إعادة حساب MaxDD بموديل محفظة تشغيل حقيقية (1% risk/trade, max 3 concurrent)
  2. تحليل الـ 62.9% expired (توزيع + تشخيص + اقتراح تعديل خروج)
  3. مقارنة Morning Bell vs Balanced على نفس الأرشيف
  4. حساسية العتبات (3 سيناريوهات: C/A/B) — تقرير فقط، لا نشر
  5. لا يلمس engine_settings على الإنتاج، لا خلط مع balanced

Usage:
    python3 scripts/morning_bell_corrections.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

import morning_bell_backtest as mb

PRICE_HISTORY_DB = str(PROJECT_ROOT / "db" / "vps_real" / "price_history.db")
PREDICTIONS_DB = str(PROJECT_ROOT / "db" / "vps_real" / "predictions.db")
OUTPUT_JSON = PROJECT_ROOT / "scripts" / "morning_bell_corrections_results.json"
OUTPUT_MD = PROJECT_ROOT / "scripts" / "morning_bell_corrections_report.md"

# ── إعدادات موديل المحفظة (P41-HIST-CORR #1) ─────────────────────────────────
PORTFOLIO_RISK_PER_TRADE_PCT = 0.01  # 1% من رأس المال مخاطرة لكل صفقة
PORTFOLIO_MAX_CONCURRENT = 3  # أقصى 3 صفقات مفتوحة
PORTFOLIO_INITIAL_EQUITY = 100.0  # نبدأ بـ 100 (نسبة %)
HARD_RETURN_CAP = mb.HARD_RETURN_CAP


# ════════════════════════════════════════════════════════════════════════════
# التصحيح 1 — Portfolio MaxDD بموديل محفظة تشغيل حقيقية
# ════════════════════════════════════════════════════════════════════════════
def compute_portfolio_equity_curve(trades: List[dict]) -> dict:
    """احسب equity curve + MaxDD بموديل محفظة تشغيل حقيقية.

    الموديل:
      - رأس مال ابتدائي = 100 (نسبة %)
      - مخاطرة 1% من رأس المال لكل صفقة (fixed fraction)
      - position_size = (risk_pct * equity) / stop_distance_pct
      - return_dollars = position_size * actual_return_pct
      - أقصى 3 صفقات مفتوحة (لو 3 مفتوحة، skip الصفقة الجديدة)
      - الباقي كاش (لا تزداد محفظة)

    Returns:
        {
            equity_curve: [{date, equity, n_open, trade_closed?}],
            final_equity, max_drawdown_pct, max_drawdown_dollars,
            n_trades_taken, n_trades_skipped, n_skipped_due_to_concurrent,
            portfolio_return_pct
        }
    """
    if not trades:
        return {
            "equity_curve": [],
            "final_equity": PORTFOLIO_INITIAL_EQUITY,
            "max_drawdown_pct": 0,
            "max_drawdown_dollars": 0,
            "n_trades_taken": 0,
            "n_trades_skipped": 0,
            "n_skipped_due_to_concurrent": 0,
            "portfolio_return_pct": 0,
        }

    # رتّب الصفقات بـ entry_date
    sorted_trades = sorted(trades, key=lambda t: (t["date"], t["ticker"]))

    # لكل صفقة، احسب entry_date + exit_date (تقريبي: entry_date + holding_days في أيام التداول)
    # سنستخدم trading_days list لتحويل holding_days → exit_date فعلي
    # لكن للتبسيط: exit_date = entry_date + holding_days (calendar days تقريبي)
    # هذا تقريب معقول لأن EGX يتداول 5 أيام/أسبوع
    from datetime import timedelta
    trade_records = []
    for t in sorted_trades:
        entry_date_str = t["date"]
        holding = t.get("holding_days", 1)
        try:
            entry_dt = datetime.strptime(entry_date_str, "%Y-%m-%d")
            exit_dt = entry_dt + timedelta(days=holding)
            exit_date_str = exit_dt.strftime("%Y-%m-%d")
        except Exception:
            exit_date_str = entry_date_str
        trade_records.append({
            **t,
            "entry_date": entry_date_str,
            "exit_date": exit_date_str,
            "entry_dt": entry_dt if "entry_dt" in locals() else None,
        })

    # تتبع equity curve زمنياً
    equity = PORTFOLIO_INITIAL_EQUITY
    peak_equity = equity
    max_dd_dollars = 0
    max_dd_pct = 0
    open_positions: List[dict] = []  # الصفقات المفتوحة حالياً
    equity_curve: List[dict] = []
    n_taken = 0
    n_skipped_concurrent = 0

    # اجمع كل أحداث (entries + exits) مرتبة زمنياً
    events: List[Tuple[str, str, dict]] = []  # (date, type, trade)
    for t in trade_records:
        events.append((t["entry_date"], "entry", t))
        events.append((t["exit_date"], "exit", t))
    events.sort(key=lambda e: (e[0], 0 if e[1] == "exit" else 1))  # exits قبل entries في نفس اليوم

    for date_str, ev_type, trade in events:
        if ev_type == "entry":
            # تحقق من حد max concurrent
            if len(open_positions) >= PORTFOLIO_MAX_CONCURRENT:
                n_skipped_concurrent += 1
                continue
            # افتح المركز
            stop_dist_pct = trade.get("atr_stop_pct", 0.05)  # افتراضي 5%
            if stop_dist_pct <= 0:
                stop_dist_pct = 0.05
            # position_size = (risk_pct * equity) / stop_dist_pct
            position_size = (PORTFOLIO_RISK_PER_TRADE_PCT * equity) / stop_dist_pct
            trade["_position_size"] = position_size
            trade["_entry_equity"] = equity
            open_positions.append(trade)
            n_taken += 1
        else:  # exit
            # أغلق المركز
            match = None
            for op in open_positions:
                if op.get("ticker") == trade.get("ticker") and op.get("entry_date") == trade.get("entry_date"):
                    match = op
                    break
            if not match:
                continue
            open_positions.remove(match)
            # احسب العائد بالدولار
            actual_return_pct = match.get("actual_return", 0) / 100.0  # تحويل من % لنسبة
            # HARD cap (Rule 7) — مُطبّق بالفعل في simulate_exit، لكن نضمن هنا
            actual_return_pct = max(-HARD_RETURN_CAP / 100, min(HARD_RETURN_CAP / 100, actual_return_pct))
            return_dollars = match["_position_size"] * actual_return_pct
            equity += return_dollars
            # تحديث peak + MaxDD
            if equity > peak_equity:
                peak_equity = equity
            dd_dollars = peak_equity - equity
            if dd_dollars > max_dd_dollars:
                max_dd_dollars = dd_dollars
                max_dd_pct = (dd_dollars / peak_equity) * 100 if peak_equity > 0 else 0
            equity_curve.append({
                "date": date_str,
                "equity": round(equity, 4),
                "n_open": len(open_positions),
                "closed_ticker": match.get("ticker"),
                "closed_return_pct": match.get("actual_return"),
                "peak": round(peak_equity, 4),
                "dd_pct": round(max_dd_pct, 4),
            })

    final_equity = equity
    portfolio_return_pct = ((final_equity - PORTFOLIO_INITIAL_EQUITY) / PORTFOLIO_INITIAL_EQUITY) * 100

    return {
        "equity_curve": equity_curve,
        "final_equity": round(final_equity, 4),
        "peak_equity": round(peak_equity, 4),
        "max_drawdown_pct": round(max_dd_pct, 4),
        "max_drawdown_dollars": round(max_dd_dollars, 4),
        "n_trades_taken": n_taken,
        "n_trades_skipped_concurrent": n_skipped_concurrent,
        "portfolio_return_pct": round(portfolio_return_pct, 4),
        "model_params": {
            "initial_equity": PORTFOLIO_INITIAL_EQUITY,
            "risk_per_trade_pct": PORTFOLIO_RISK_PER_TRADE_PCT,
            "max_concurrent": PORTFOLIO_MAX_CONCURRENT,
        },
    }


# ════════════════════════════════════════════════════════════════════════════
# التصحيح 2 — تحليل الـ Expired
# ════════════════════════════════════════════════════════════════════════════
def analyze_expired(trades: List[dict], by_ticker: Dict[str, List[dict]]) -> dict:
    """تحليل الصفقات التي انتهت expired (لم تلمس TP/SL خلال 5 أيام)."""
    expired = [t for t in trades if t.get("exit_type") == "expired"]
    non_expired = [t for t in trades if t.get("exit_type") != "expired"]

    if not expired:
        return {"n_expired": 0, "analysis": "no expired trades"}

    # توزيع العائد عند الـ expired
    expired_returns = [t["actual_return"] for t in expired]
    expired_wins = [r for r in expired_returns if r > 0]
    expired_losses = [r for r in expired_returns if r < 0]
    expired_flat = [r for r in expired_returns if r == 0]

    # تشخيص: هل الهدف بعيد؟ قارن high_reached (أعلى سعر خلال الاحتجاز) vs TP1/TP2
    # نحتاج إعادة حساب highest_price_reached من price_history
    diagnosis = {
        "tp_too_far": 0,  # high وصل قرب TP1 لكن ما لمسه
        "stop_too_tight": 0,  # low اقترب من stop لكن ما لمسه
        "stalled": 0,  # السعر تحرك قليل (|return| < 2%)
        "momentum_died": 0,  # بدأ قوي ثم مات
    }

    for t in expired:
        ticker = t["ticker"]
        rows = by_ticker.get(ticker, [])
        if not rows:
            continue
        # ابحث عن idx ليوم الدخول
        entry_idx = None
        for i, r in enumerate(rows):
            if r["date"] == t["date"]:
                entry_idx = i
                break
        if entry_idx is None:
            continue

        # أعلى/أدنى سعر خلال فترة الاحتجاز
        end_idx = min(entry_idx + t["holding_days"] + 1, len(rows))
        hold_rows = rows[entry_idx:end_idx]
        if not hold_rows:
            continue
        highest = max(r["high"] for r in hold_rows)
        lowest = min(r["low"] for r in hold_rows)
        entry = t["entry_price"]
        tp1 = t["tp1"]
        tp2 = t["tp2"]
        stop = t["stop"]

        # مسافة من الهدف
        dist_to_tp1_pct = ((tp1 - highest) / highest) * 100 if highest > 0 else 0
        dist_to_stop_pct = ((lowest - stop) / stop) * 100 if stop > 0 else 0

        actual_ret = t["actual_return"]

        if abs(actual_ret) < 2.0:
            diagnosis["stalled"] += 1
        elif dist_to_tp1_pct > 0 and dist_to_tp1_pct <= 2.0:
            diagnosis["tp_too_far"] += 1  # قرب TP1 لكن ما لمسه
        elif dist_to_stop_pct > 0 and dist_to_stop_pct <= 2.0:
            diagnosis["stop_too_tight"] += 1  # قرب stop لكن ما لمسه
        else:
            diagnosis["momentum_died"] += 1

    # مقارنة expired vs non-expired
    expired_avg_rvol = sum(t["rvol"] for t in expired) / len(expired) if expired else 0
    non_expired_avg_rvol = sum(t["rvol"] for t in non_expired) / len(non_expired) if non_expired else 0
    expired_avg_ext = sum(t["extension_pct_day"] for t in expired) / len(expired) if expired else 0
    non_expired_avg_ext = sum(t["extension_pct_day"] for t in non_expired) / len(non_expired) if non_expired else 0

    # اقتراح تعديل خروج واحد مربوط برقم
    # الفكرة: trailing exit بعد +X% (نقطة التعادل + ربح صغير)
    # نحسب لو طبّقنا trailing exit عند +3% من entry كم ستتحسن النتائج
    trailing_test_returns = []
    for t in expired:
        ticker = t["ticker"]
        rows = by_ticker.get(ticker, [])
        entry_idx = None
        for i, r in enumerate(rows):
            if r["date"] == t["date"]:
                entry_idx = i
                break
        if entry_idx is None:
            continue
        end_idx = min(entry_idx + t["holding_days"] + 1, len(rows))
        entry = t["entry_price"]
        trailing_pct = 0.03  # +3%
        trailing_trigger = entry * (1 + trailing_pct)
        new_return = None
        for k in range(entry_idx + 1, end_idx):
            if rows[k]["high"] >= trailing_trigger:
                # خرج عند trailing trigger
                new_return = ((trailing_trigger - entry) / entry) * 100
                break
        if new_return is None:
            # ما لمسش trailing، اخلع عند close[end_idx-1]
            new_return = ((rows[end_idx - 1]["close"] - entry) / entry) * 100
        new_return = max(-HARD_RETURN_CAP, min(HARD_RETURN_CAP, new_return))
        trailing_test_returns.append(new_return)

    trailing_improvement = None
    if trailing_test_returns:
        old_avg = sum(expired_returns) / len(expired_returns) if expired_returns else 0
        new_avg = sum(trailing_test_returns) / len(trailing_test_returns)
        new_wins = sum(1 for r in trailing_test_returns if r > 0)
        new_wr = (new_wins / len(trailing_test_returns)) * 100
        old_wins = sum(1 for r in expired_returns if r > 0)
        old_wr = (old_wins / len(expired_returns)) * 100 if expired_returns else 0
        trailing_improvement = {
            "proposal": f"Trailing exit بعد +{trailing_pct*100:.0f}% من entry (جني سريع بدل انتظار TP1)",
            "old_avg_return": round(old_avg, 4),
            "new_avg_return": round(new_avg, 4),
            "old_win_rate": round(old_wr, 2),
            "new_win_rate": round(new_wr, 2),
            "delta_avg_return": round(new_avg - old_avg, 4),
            "delta_win_rate": round(new_wr - old_wr, 2),
            "n_tested": len(trailing_test_returns),
        }

    return {
        "n_expired": len(expired),
        "n_non_expired": len(non_expired),
        "pct_expired": round((len(expired) / len(trades)) * 100, 2) if trades else 0,
        "return_distribution": {
            "wins": len(expired_wins),
            "losses": len(expired_losses),
            "flat": len(expired_flat),
            "win_rate": round((len(expired_wins) / len(expired)) * 100, 2) if expired else 0,
            "avg_return": round(sum(expired_returns) / len(expired_returns), 4) if expired_returns else 0,
            "max_win": round(max(expired_returns), 4) if expired_returns else 0,
            "max_loss": round(min(expired_returns), 4) if expired_returns else 0,
        },
        "diagnosis": diagnosis,
        "comparison_expired_vs_non": {
            "expired_avg_rvol": round(expired_avg_rvol, 2),
            "non_expired_avg_rvol": round(non_expired_avg_rvol, 2),
            "expired_avg_extension": round(expired_avg_ext, 2),
            "non_expired_avg_extension": round(non_expired_avg_ext, 2),
        },
        "exit_proposal_test": trailing_improvement,
    }


# ════════════════════════════════════════════════════════════════════════════
# التصحيح 3 — مقارنة Morning Bell vs Balanced على نفس الأرشيف
# ════════════════════════════════════════════════════════════════════════════
def load_balanced_predictions(db_path: str) -> List[dict]:
    """حمّل توقعات balanced المغلقة من predictions.db (نفس الأرشيف)."""
    if not os.path.exists(db_path):
        return []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    # schema-aware (Rule 6): COALESCE(signal, signal_type)
    cur.execute(
        """
        SELECT
            id, ticker, COALESCE(signal, signal_type) as signal,
            prediction_date, entry_price, target_price, stop_loss,
            actual_return, hit_target, hit_stop, holding_days,
            exit_type, status, risk_reward, atr_at_entry,
            highest_price_reached, lowest_price_reached
        FROM predictions
        WHERE persona='balanced'
          AND actual_return IS NOT NULL
          AND ABS(actual_return) <= ?
        """,
        (HARD_RETURN_CAP,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def compute_balanced_metrics(preds: List[dict]) -> dict:
    """احسب WR/PF/Expectancy/MaxDD لـ balanced."""
    if not preds:
        return {"n": 0}
    returns = [float(p["actual_return"]) for p in preds if p["actual_return"] is not None]
    if not returns:
        return {"n": len(preds), "note": "no actual_return"}
    wins = [r for r in returns if r > 0]
    losses = [r for r in returns if r < 0]
    gp = sum(wins)
    gl = abs(sum(losses))
    n = len(returns)
    wr = (len(wins) / n) * 100 if n else 0
    pf = (gp / gl) if gl > 0 else (999.0 if gp > 0 else 0.0)
    expectancy = sum(returns) / n if n else 0
    # MaxDD على السلسلة التراكمية
    cum = 0
    peak = 0
    max_dd = 0
    for r in returns:
        cum += r
        if cum > peak:
            peak = cum
        dd = peak - cum
        if dd > max_dd:
            max_dd = dd
    # holding_days في الأرشيف = 0 لـ balanced (مشكلة تسجيل بيانات، ليس حسابي)
    # نحاول days_to_close كبديل
    days_vals = [p.get("days_to_close") for p in preds if p.get("days_to_close")]
    avg_days = (sum(days_vals) / len(days_vals)) if days_vals else 0
    days_note = "N/A (holding_days=0 في الأرشيف، days_to_close=NULL)" if not days_vals else f"from days_to_close ({len(days_vals)} rows)"
    return {
        "n": n,
        "win_rate": round(wr, 2),
        "profit_factor": round(pf, 3),
        "expectancy": round(expectancy, 4),
        "max_drawdown": round(max_dd, 4),
        "avg_holding_days": round(avg_days, 2),
        "avg_holding_days_note": days_note,
        "gross_profit": round(gp, 4),
        "gross_loss": round(gl, 4),
        "max_win": round(max(returns), 4) if returns else 0,
        "max_loss": round(min(returns), 4) if returns else 0,
    }


def compare_morning_bell_vs_balanced(morning_bell_trades: List[dict], balanced_preds: List[dict]) -> dict:
    """جدول مقارنة جنباً إلى جنب."""
    mb_metrics = mb.compute_metrics(morning_bell_trades)
    bal_metrics = compute_balanced_metrics(balanced_preds)

    # نطاق التواريخ لكل قناة
    mb_dates = [t["date"] for t in morning_bell_trades]
    bal_dates = [p["prediction_date"] for p in balanced_preds if p["prediction_date"]]

    return {
        "morning_bell": {
            "channel": "morning_bell_historical",
            "date_range": {
                "start": min(mb_dates) if mb_dates else None,
                "end": max(mb_dates) if mb_dates else None,
            },
            "n_trades": mb_metrics["n_trades"],
            "win_rate": mb_metrics["win_rate"],
            "profit_factor": mb_metrics["profit_factor"],
            "expectancy": mb_metrics["expectancy"],
            "max_drawdown": mb_metrics["max_drawdown"],
            "avg_holding_days": mb_metrics["avg_holding_days"],
            "max_loss": mb_metrics["max_loss"],
            "max_win": mb_metrics["max_win"],
            "stats_separated": True,
            "note": "محاكاة تاريخية على price_history.db — لا تُكتب في predictions DB",
        },
        "balanced": {
            "channel": "balanced",
            "date_range": {
                "start": min(bal_dates) if bal_dates else None,
                "end": max(bal_dates) if bal_dates else None,
            },
            "n_trades": bal_metrics.get("n", 0),
            "win_rate": bal_metrics.get("win_rate", 0),
            "profit_factor": bal_metrics.get("profit_factor", 0),
            "expectancy": bal_metrics.get("expectancy", 0),
            "max_drawdown": bal_metrics.get("max_drawdown", 0),
            "avg_holding_days": bal_metrics.get("avg_holding_days", 0),
            "max_loss": bal_metrics.get("max_loss", 0),
            "max_win": bal_metrics.get("max_win", 0),
            "stats_separated": True,
            "note": "توقعات حقيقية من predictions.db (الأرشيف) — مسار منضبط",
        },
        "delta_mb_minus_balanced": {
            "win_rate_delta": round(mb_metrics["win_rate"] - bal_metrics.get("win_rate", 0), 2),
            "profit_factor_delta": round(mb_metrics["profit_factor"] - bal_metrics.get("profit_factor", 0), 3),
            "expectancy_delta": round(mb_metrics["expectancy"] - bal_metrics.get("expectancy", 0), 4),
            "max_drawdown_delta": round(mb_metrics["max_drawdown"] - bal_metrics.get("max_drawdown", 0), 4),
        },
    }


# ════════════════════════════════════════════════════════════════════════════
# التصحيح 4 — حساسية العتبات (3 سيناريوهات)
# ════════════════════════════════════════════════════════════════════════════
def run_sensitivity_scenarios(by_ticker: Dict[str, List[dict]]) -> dict:
    """شغّل 3 سيناريوهات عتبات وقارن."""
    scenarios = [
        {
            "name": "C (current)",
            "label": "الحالي: RVOL≥1.5, ext≥1.0%",
            "rvol_threshold": 1.5,
            "min_extension_pct": 1.0,
        },
        {
            "name": "A",
            "label": "تضييق RVOL: RVOL≥2.0, ext≥1.0%",
            "rvol_threshold": 2.0,
            "min_extension_pct": 1.0,
        },
        {
            "name": "B",
            "label": "تضييق مزدوج: RVOL≥2.0, ext≥2.0%",
            "rvol_threshold": 2.0,
            "min_extension_pct": 2.0,
        },
    ]

    results = []
    for sc in scenarios:
        print(f"\n  🔬 Scenario {sc['name']}: {sc['label']}")
        # شغّل backtest بهذه العتبات (verbose=False للتسريع)
        bt = mb.run_backtest(
            by_ticker,
            rvol_threshold=sc["rvol_threshold"],
            min_extension_pct=sc["min_extension_pct"],
            verbose=False,
        )
        trades = []
        # استخراج الصفقات من bt — لكن run_backtest يرجع result كامل بدون all_trades.
        # سأعيد بناء trades من worst_20 + best_20 + summary... لا، هذا ناقص.
        # الحل: نعيد تشغيل scan + simulate يدوياً هنا.
        # لكن run_backtest يرجع dict به summary فقط. أحتاج trades raw.
        # سأعدّل run_backtest ليرجع trades أيضاً... أو سأعيد بناء هنا.

        # أبسط حل: أعيد بناء trades هنا باستخدام scan + simulate
        trading_days = mb.get_trading_days(by_ticker)
        date_to_idx = {ticker: {r["date"]: i for i, r in enumerate(rows)} for ticker, rows in by_ticker.items()}
        trades = []
        for i, day in enumerate(trading_days):
            if i < mb.WARMUP_DAYS:
                continue
            picks = mb.scan_morning_bell_candidates(
                by_ticker, date_to_idx, day,
                rvol_threshold=sc["rvol_threshold"],
                min_extension_pct=sc["min_extension_pct"],
            )
            for pick in picks:
                rows = by_ticker[pick["ticker"]]
                entry_idx = pick["idx"]
                exit_result = mb.simulate_exit(rows, entry_idx, pick)
                trades.append({**{k: v for k, v in pick.items() if k != "idx"}, **exit_result})

        metrics = mb.compute_metrics(trades)
        portfolio = compute_portfolio_equity_curve(trades)

        results.append({
            "scenario": sc["name"],
            "label": sc["label"],
            "thresholds": {
                "rvol_threshold": sc["rvol_threshold"],
                "min_extension_pct": sc["min_extension_pct"],
            },
            "metrics": metrics,
            "portfolio_maxdd_pct": portfolio["max_drawdown_pct"],
            "portfolio_return_pct": portfolio["portfolio_return_pct"],
            "n_trades_taken_in_portfolio": portfolio["n_trades_taken"],
            "n_skipped_concurrent": portfolio["n_trades_skipped_concurrent"],
        })

    return {"scenarios": results}


# ════════════════════════════════════════════════════════════════════════════
# توليد التقرير الموحد
# ════════════════════════════════════════════════════════════════════════════
def generate_corrections_report(corrections: dict) -> str:
    """ولّد تقرير Markdown موحد لكل التصحيحات."""
    md = []
    md.append("# 🔧 تصحيحات قياس جرس الصباح (P41-HIST-CORR)\n")
    md.append(f"> **التشغيل:** {corrections['run_at']}\n")
    md.append(f"> **الأرشيف:** `active_databases_20260817_full.zip`\n")
    md.append(f"> **DB:** `{PRICE_HISTORY_DB}`\n")
    md.append(f"> **هدف التصحيحات:** إعادة قياس MaxDD بموديل محفظة + تحليل expired + مقارنة balanced + حساسية العتبات\n\n")
    md.append("---\n")

    # ── التصحيح 1: Portfolio MaxDD ─────────────────────────────────────────
    md.append("## 1️⃣ التصحيح 1 — MaxDD بموديل محفظة تشغيل حقيقية\n")
    p = corrections["portfolio_maxdd"]
    md.append("**الموديل:**")
    md.append(f"- رأس مال ابتدائي: {p['model_params']['initial_equity']}")
    md.append(f"- مخاطرة لكل صفقة: {p['model_params']['risk_per_trade_pct']*100}% من رأس المال")
    md.append(f"- أقصى صفقات مفتوحة: {p['model_params']['max_concurrent']}")
    md.append(f"- الباقي كاش (لا تزداد محفظة)\n")
    md.append("**النتائج:**\n")
    md.append(f"| المؤشر | القيمة (السابق) | القيمة (الجديد بموديل محفظة) |")
    md.append(f"|---------|-----------------|------------------------------|")
    md.append(f"| Final Equity | 100 (افتراضي) | **{p['final_equity']}** |")
    md.append(f"| Portfolio Return % | — | **{p['portfolio_return_pct']}%** |")
    md.append(f"| Max Drawdown % | 67.07% (على عوائد خام متسلسلة) | **{p['max_drawdown_pct']}%** (بموديل محفظة) |")
    md.append(f"| Max Drawdown $ | — | {p['max_drawdown_dollars']} |")
    md.append(f"| Peak Equity | — | {p['peak_equity']} |")
    md.append(f"| n_trades taken | 124 (كلها) | {p['n_trades_taken']} (مع حد 3 concurrent) |")
    md.append(f"| n_trades skipped (concurrent limit) | — | {p['n_trades_skipped_concurrent']} |")
    md.append("")
    md.append("> 💡 **الفرق جوهري:** 67.07% كان على سلسلة عوائد خام (افتراض 100% من المحفظة في كل صفقة).")
    md.append(f"> **بموديل محفظة حقيقي (1% risk, max 3 concurrent): MaxDD = {p['max_drawdown_pct']}%** — وهذا هو الرقم الذي يصف التشغيل الفعلي.\n")

    # Equity curve summary (آخر 10 نقاط)
    curve = p["equity_curve"][-10:] if p["equity_curve"] else []
    if curve:
        md.append("**آخر 10 نقاط في equity curve:**\n")
        md.append(f"| التاريخ | Equity | n_open | Closed Ticker | Return % | Peak | DD % |")
        md.append(f"|---------|--------|--------|---------------|----------|------|------|")
        for pt in curve:
            md.append(f"| {pt['date']} | {pt['equity']} | {pt['n_open']} | {pt.get('closed_ticker', '-')} | {pt.get('closed_return_pct', '-')}% | {pt['peak']} | {pt['dd_pct']} |")
    md.append("")

    # ── التصحيح 2: Expired Analysis ────────────────────────────────────────
    md.append("---\n## 2️⃣ التصحيح 2 — تحليل الـ 62.9% Expired\n")
    e = corrections["expired_analysis"]
    md.append(f"**n_expired:** {e['n_expired']} من {e['n_expired'] + e['n_non_expired']} ({e['pct_expired']}%)\n")
    rd = e["return_distribution"]
    md.append("**توزيع العائد عند الـ expired:**\n")
    md.append(f"| البيان | القيمة |")
    md.append(f"|---------|--------|")
    md.append(f"| Wins | {rd['wins']} |")
    md.append(f"| Losses | {rd['losses']} |")
    md.append(f"| Flat | {rd['flat']} |")
    md.append(f"| Win Rate | {rd['win_rate']}% |")
    md.append(f"| Avg Return | {rd['avg_return']}% |")
    md.append(f"| Max Win | {rd['max_win']}% |")
    md.append(f"| Max Loss | {rd['max_loss']}% |")
    md.append("")
    md.append("**التشخيص:**\n")
    diag = e["diagnosis"]
    md.append(f"| السبب | العدد |")
    md.append(f"|-------|------|")
    md.append(f"| stalled (|return| < 2%) | {diag['stalled']} |")
    md.append(f"| tp_too_far (قرب TP1 لكن ما لمسه) | {diag['tp_too_far']} |")
    md.append(f"| stop_too_tight (قرب stop لكن ما لمسه) | {diag['stop_too_tight']} |")
    md.append(f"| momentum_died (باقي) | {diag['momentum_died']} |")
    md.append("")
    comp = e["comparison_expired_vs_non"]
    md.append("**مقارنة expired vs non-expired:**\n")
    md.append(f"| البيان | Expired | Non-Expired |")
    md.append(f"|---------|---------|-------------|")
    md.append(f"| Avg RVOL | {comp['expired_avg_rvol']} | {comp['non_expired_avg_rvol']} |")
    md.append(f"| Avg Extension % | {comp['expired_avg_extension']} | {comp['non_expired_avg_extension']} |")
    md.append("")
    prop = e.get("exit_proposal_test")
    if prop:
        md.append("**اقتراح تعديل خروج واحد مربوط برقم (لل اختبار، لا تطبيق على الإنتاج):**\n")
        md.append(f"> {prop['proposal']}\n")
        md.append(f"| البيان | قبل | بعد | Delta |")
        md.append(f"|---------|------|------|-------|")
        md.append(f"| Avg Return % | {prop['old_avg_return']} | {prop['new_avg_return']} | {prop['delta_avg_return']:+} |")
        md.append(f"| Win Rate % | {prop['old_win_rate']} | {prop['new_win_rate']} | {prop['delta_win_rate']:+} |")
        md.append(f"\n**n_tested:** {prop['n_tested']}")
    md.append("")

    # ── التصحيح 3: Morning Bell vs Balanced ───────────────────────────────
    md.append("---\n## 3️⃣ التصحيح 3 — مقارنة Morning Bell vs Balanced\n")
    cmp_data = corrections["comparison"]
    mb_d = cmp_data["morning_bell"]
    bal_d = cmp_data["balanced"]
    delta = cmp_data["delta_mb_minus_balanced"]
    md.append(f"| المؤشر | Morning Bell (محاكاة) | Balanced (أرشيف) | Delta (MB - Bal) |")
    md.append(f"|---------|----------------------|-------------------|------------------|")
    md.append(f"| **n_trades** | {mb_d['n_trades']} | {bal_d['n_trades']} | {mb_d['n_trades'] - bal_d['n_trades']} |")
    md.append(f"| **Win Rate %** | **{mb_d['win_rate']}** | **{bal_d['win_rate']}** | {delta['win_rate_delta']:+} |")
    md.append(f"| **Profit Factor** | **{mb_d['profit_factor']}** | **{bal_d['profit_factor']}** | {delta['profit_factor_delta']:+} |")
    md.append(f"| **Expectancy %** | **{mb_d['expectancy']}** | **{bal_d['expectancy']}** | {delta['expectancy_delta']:+} |")
    md.append(f"| **Max Drawdown %** | {mb_d['max_drawdown']} | {bal_d['max_drawdown']} | {delta['max_drawdown_delta']:+} |")
    md.append(f"| **Avg Holding Days** | {mb_d['avg_holding_days']} | {bal_d['avg_holding_days']} ({bal_d.get('avg_holding_days_note', 'N/A')}) | — |")
    md.append(f"| Max Loss % | {mb_d['max_loss']} | {bal_d['max_loss']} | {round(mb_d['max_loss'] - bal_d['max_loss'], 4):+} |")
    md.append(f"| Max Win % | {mb_d['max_win']} | {bal_d['max_win']} | {round(mb_d['max_win'] - bal_d['max_win'], 4):+} |")
    md.append(f"| Date Range | {mb_d['date_range']['start']} → {mb_d['date_range']['end']} | {bal_d['date_range']['start']} → {bal_d['date_range']['end']} | — |")
    md.append("")
    md.append(f"> 📌 **Morning Bell:** {mb_d['note']}")
    md.append(f"> 📌 **Balanced:** {bal_d['note']}")
    md.append("")

    # ── التصحيح 4: Sensitivity ────────────────────────────────────────────
    md.append("---\n## 4️⃣ التصحيح 4 — حساسية العتبات (3 سيناريوهات)\n")
    md.append("> **تقرير فقط — لا تطبيق على الإنتاج.** الهدف: قياس أثر تضييق RVOL/extension قبل أي قرار.\n")
    sens = corrections["sensitivity"]
    md.append(f"| السيناريو | n | WR % | PF | Expectancy % | MaxDD (raw) % | MaxDD (portfolio) % | Portfolio Return % | n_skipped_concurrent |")
    md.append(f"|-----------|---|------|-----|--------------|---------------|---------------------|---------------------|----------------------|")
    for sc in sens["scenarios"]:
        m = sc["metrics"]
        md.append(
            f"| **{sc['scenario']}** ({sc['label']}) | {m['n_trades']} | {m['win_rate']} | "
            f"{m['profit_factor']} | {m['expectancy']} | {m['max_drawdown']} | "
            f"**{sc['portfolio_maxdd_pct']}** | {sc['portfolio_return_pct']} | {sc['n_skipped_concurrent']} |"
        )
    md.append("")
    md.append("**تفاصيل العتبات:**\n")
    for sc in sens["scenarios"]:
        md.append(f"- **{sc['scenario']}:** RVOL≥{sc['thresholds']['rvol_threshold']}, ext≥{sc['thresholds']['min_extension_pct']}%")
    md.append("")

    # ── التوصية النهائية ───────────────────────────────────────────────────
    md.append("---\n## 🎯 التوصية النهائية (مربوطة بالأرقام)\n")
    # اختر أفضل سيناريو بناءً على portfolio MaxDD + expectancy
    best_scenario = None
    best_score = -999
    for sc in sens["scenarios"]:
        # score = expectancy - (portfolio_maxdd / 10)  — نحاول تحسين expectancy مع تقليل MaxDD
        score = sc["metrics"]["expectancy"] - (sc["portfolio_maxdd_pct"] / 10)
        if score > best_score:
            best_score = score
            best_scenario = sc
    md.append(f"**بناءً على الأرقام (score = expectancy - portfolio_MaxDD/10):**\n")
    md.append(f"- 🏆 **السيناريو المفضّل:** {best_scenario['scenario']} ({best_scenario['label']})")
    md.append(f"  - n={best_scenario['metrics']['n_trades']}, WR={best_scenario['metrics']['win_rate']}%, PF={best_scenario['metrics']['profit_factor']}")
    md.append(f"  - Expectancy={best_scenario['metrics']['expectancy']}%, Portfolio MaxDD={best_scenario['portfolio_maxdd_pct']}%")
    md.append(f"  - Portfolio Return={best_scenario['portfolio_return_pct']}%\n")

    # مقارنة مع balanced
    if bal_d["n_trades"] > 0:
        md.append(f"**مقارنة مع Balanced:**")
        if mb_d["expectancy"] < bal_d["expectancy"]:
            md.append(f"- ⚠️ Morning Bell expectancy ({mb_d['expectancy']}%) < Balanced ({bal_d['expectancy']}%) — القناة تُخصم من العائد")
        else:
            md.append(f"- ✅ Morning Bell expectancy ({mb_d['expectancy']}%) > Balanced ({bal_d['expectancy']}%) — القناة تضيف قيمة")
        if mb_d["win_rate"] < bal_d["win_rate"]:
            md.append(f"- ⚠️ Morning Bell WR ({mb_d['win_rate']}%) < Balanced ({bal_d['win_rate']}%) — معدل إصابة أقل")
        else:
            md.append(f"- ✅ Morning Bell WR ({mb_d['win_rate']}%) > Balanced ({bal_d['win_rate']}%) — معدل إصابة أعلى")
    md.append("")
    md.append("**القرار التشغيلي المقترح:**")
    md.append(f"- 🔴 لا تفتح جرس الصباح كقناة رئيسية بعد")
    md.append(f"- 🟡 شغّل كقناة \"شمال / مسؤولية العميل\" بحجم محدود (1% risk, max 3 concurrent)")
    md.append(f"- 🟢 طبّق سيناريو {best_scenario['scenario']} في جلسات حية مراقبة (5-10 جلسات) قبل التوسع")
    md.append(f"- 🔵 اختبر اقتراح trailing exit (+3%) على البيانات الحية قبل اعتماده")
    md.append("")
    md.append("---\n")
    md.append(f"\n*تم التشغيل بواسطة Z.ai Code — {datetime.now(timezone.utc).isoformat()}*")
    return "\n".join(md)


# ════════════════════════════════════════════════════════════════════════════
# Entry point
# ════════════════════════════════════════════════════════════════════════════
def main():
    print("=" * 70)
    print("🔧 Morning Bell Measurement Corrections (P41-HIST-CORR)")
    print("=" * 70)
    print(f"📁 Archive: active_databases_20260817_full.zip")
    print(f"🗄️  DB: {PRICE_HISTORY_DB}")
    print(f"📊 Predictions DB: {PREDICTIONS_DB}")
    print("=" * 70)

    # تحقق من وجود DBs
    if not os.path.exists(PRICE_HISTORY_DB):
        print(f"❌ price_history.db not found")
        sys.exit(1)

    # حمّل price_history مرة واحدة
    by_ticker = mb.load_price_history(PRICE_HISTORY_DB)
    if not by_ticker:
        print("❌ No data loaded")
        sys.exit(1)

    # ── شغّل backtest الأساسي (السيناريو C) ───────────────────────────────
    print("\n" + "=" * 70)
    print("🔬 Running base backtest (Scenario C: current thresholds)")
    print("=" * 70)
    base_result = mb.run_backtest(by_ticker, verbose=True)

    # استخراج trades من base_result (نحتاج raw trades)
    # base_result يحتوي summary فقط، نعيد بناء trades:
    print("\n🔄 Reconstructing raw trades for corrections...")
    trading_days = mb.get_trading_days(by_ticker)
    date_to_idx = {ticker: {r["date"]: i for i, r in enumerate(rows)} for ticker, rows in by_ticker.items()}
    base_trades: List[dict] = []
    for i, day in enumerate(trading_days):
        if i < mb.WARMUP_DAYS:
            continue
        picks = mb.scan_morning_bell_candidates(by_ticker, date_to_idx, day)
        for pick in picks:
            rows = by_ticker[pick["ticker"]]
            entry_idx = pick["idx"]
            exit_result = mb.simulate_exit(rows, entry_idx, pick)
            base_trades.append({**{k: v for k, v in pick.items() if k != "idx"}, **exit_result})
    print(f"   ✅ Reconstructed {len(base_trades)} base trades")

    # ── التصحيح 1: Portfolio MaxDD ─────────────────────────────────────────
    print("\n" + "=" * 70)
    print("1️⃣  Correction 1: Portfolio MaxDD model (1% risk, max 3 concurrent)")
    print("=" * 70)
    portfolio = compute_portfolio_equity_curve(base_trades)
    print(f"   Final Equity: {portfolio['final_equity']}")
    print(f"   Portfolio Return: {portfolio['portfolio_return_pct']}%")
    print(f"   MaxDD (portfolio): {portfolio['max_drawdown_pct']}%")
    print(f"   MaxDD (raw, previous): 67.07%")
    print(f"   n_taken: {portfolio['n_trades_taken']}, n_skipped: {portfolio['n_trades_skipped_concurrent']}")

    # ── التصحيح 2: Expired Analysis ───────────────────────────────────────
    print("\n" + "=" * 70)
    print("2️⃣  Correction 2: Expired analysis (62.9% of trades)")
    print("=" * 70)
    expired_analysis = analyze_expired(base_trades, by_ticker)
    print(f"   n_expired: {expired_analysis['n_expired']} ({expired_analysis['pct_expired']}%)")
    print(f"   Expired WR: {expired_analysis['return_distribution']['win_rate']}%")
    print(f"   Expired avg return: {expired_analysis['return_distribution']['avg_return']}%")
    print(f"   Diagnosis: {expired_analysis['diagnosis']}")
    if expired_analysis.get("exit_proposal_test"):
        prop = expired_analysis["exit_proposal_test"]
        print(f"   Proposal: {prop['proposal']}")
        print(f"     delta_avg_return: {prop['delta_avg_return']:+}")
        print(f"     delta_win_rate: {prop['delta_win_rate']:+}")

    # ── التصحيح 3: Morning Bell vs Balanced ───────────────────────────────
    print("\n" + "=" * 70)
    print("3️⃣  Correction 3: Morning Bell vs Balanced comparison")
    print("=" * 70)
    balanced_preds = load_balanced_predictions(PREDICTIONS_DB)
    print(f"   Loaded {len(balanced_preds)} balanced predictions from predictions.db")
    comparison = compare_morning_bell_vs_balanced(base_trades, balanced_preds)
    print(f"   Morning Bell: n={comparison['morning_bell']['n_trades']}, WR={comparison['morning_bell']['win_rate']}%, PF={comparison['morning_bell']['profit_factor']}")
    print(f"   Balanced:     n={comparison['balanced']['n_trades']}, WR={comparison['balanced']['win_rate']}%, PF={comparison['balanced']['profit_factor']}")
    print(f"   Delta expectancy: {comparison['delta_mb_minus_balanced']['expectancy_delta']:+}")

    # ── التصحيح 4: Sensitivity ────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("4️⃣  Correction 4: Threshold sensitivity (3 scenarios)")
    print("=" * 70)
    sensitivity = run_sensitivity_scenarios(by_ticker)
    for sc in sensitivity["scenarios"]:
        m = sc["metrics"]
        print(f"   {sc['scenario']}: n={m['n_trades']}, WR={m['win_rate']}%, PF={m['profit_factor']}, "
              f"Exp={m['expectancy']}%, MaxDD_portfolio={sc['portfolio_maxdd_pct']}%")

    # ── تجميع النتائج ──────────────────────────────────────────────────────
    corrections = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "archive": "active_databases_20260817_full.zip",
        "price_history_db": PRICE_HISTORY_DB,
        "predictions_db": PREDICTIONS_DB,
        "portfolio_maxdd": portfolio,
        "expired_analysis": expired_analysis,
        "comparison": comparison,
        "sensitivity": sensitivity,
    }

    # احفظ JSON
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(corrections, f, ensure_ascii=False, indent=2, default=str)
    print(f"\n💾 JSON saved: {OUTPUT_JSON}")

    # احفظ Markdown
    md_report = generate_corrections_report(corrections)
    with open(OUTPUT_MD, "w", encoding="utf-8") as f:
        f.write(md_report)
    print(f"📄 Markdown saved: {OUTPUT_MD}")

    print("\n" + "=" * 70)
    print("✅ Corrections complete")
    print("=" * 70)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Morning Bell Historical Backtest (P41-HIST-SIM)
================================================
محاكاة تاريخية كاملة لقواعد جرس الصباح الجديدة على الأرشيف الكبير.

المنطق (نفس _get_morning_bell_live في stored_analysis_routes.py):
  1. لكل يوم تداولي D في [start, end]:
     a. امسح كل أسهم EGX في price_history.db
     b. لكل سهم: احسب RVOL + extension + continuation + ATR
     c. بوابة: RVOL >= 1.5 + extension >= 1.0% + سيولة >= 500K EGP
     d. رتّب بـ composite score (0.35*RVOL + 0.25*ext + 0.25*cont + 0.15*liq)
     e. خذ أعلى 5 (morning_bell_max_picks)
  2. لكل توصية: محاكاة الخروج على آفاق 0/1/3/5 أيام
  3. طبق TP1 (1.5R, جزئي 50% + رفع الوقف لـ breakeven) + TP2 (3R) + Stop (ATR 3-9%)
  4. احسب: n, WR, PF, Expectancy, Max loss, MaxDD, avg holding days
  5. افصل تماماً عن balanced stats (channel=morning_bell_historical)

القواعد المطبقة (CONSTITUTION):
  - Rule 7: HARD cap ABS(actual_return) <= 50
  - Rule 8: ATR stop في [3%, 9%]
  - Rule 13: MIN_TURNOVER_EGP = 500_000
  - R:R floor >= 1.5 (TP1 = 1.5R, TP2 = 3R)

الأرشيف: db/vps_real/price_history.db (مستخرج من active_databases_20260817_full.zip)

Output:
  - scripts/morning_bell_backtest_results.json (النتائج الكاملة)
  - scripts/morning_bell_backtest_report.md (تقرير قابل للقراءة)

Usage:
    python3 scripts/morning_bell_backtest.py
    python3 scripts/morning_bell_backtest.py --start 2025-03-01 --end 2026-08-17
    python3 scripts/morning_bell_backtest.py --horizon 5 --top-n 5
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_SERVICE = PROJECT_ROOT / "vps-service"
sys.path.insert(0, str(VPS_SERVICE))

PRICE_HISTORY_DB = str(PROJECT_ROOT / "db" / "vps_real" / "price_history.db")
OUTPUT_JSON = PROJECT_ROOT / "scripts" / "morning_bell_backtest_results.json"
OUTPUT_MD = PROJECT_ROOT / "scripts" / "morning_bell_backtest_report.md"

# ── إعدادات جرس الصباح (من engine_settings.py — Rule 11) ─────────────────────
MORNING_BELL_MAX_PICKS = 5
MORNING_BELL_RVOL_THRESHOLD = 1.5
MORNING_BELL_MIN_EXTENSION_PCT = 1.0
MORNING_BELL_W_RVOL = 0.35
MORNING_BELL_W_EXT = 0.25
MORNING_BELL_W_CONT = 0.25
MORNING_BELL_W_LIQ = 0.15

# ── قواعد CONSTITUTION الصارمة ────────────────────────────────────────────────
MIN_TURNOVER_EGP = 500_000.0  # Rule 13
ATR_STOP_MIN_PCT = 0.03  # Rule 8
ATR_STOP_MAX_PCT = 0.09  # Rule 8
RR_FLOOR = 1.5  # R:R floor
TP1_R_MULT = 1.5  # TP1 = 1.5R
TP2_R_MULT = 3.0  # TP2 = 3R
PARTIAL_EXIT_PCT = 0.50  # 50% at TP1 (Rule 10)
HARD_RETURN_CAP = 50.0  # Rule 7
HOLDING_MAX_DAYS = 5  # أقصى أفق احتجاز

WARMUP_DAYS = 25  # نحتاج 20 يوم لـ avg_volume + 14 لـ ATR + هامش

# ── فلاتر جودة البيانات (P41-HIST-SIM tuning) ────────────────────────────────
# هذه الفلاتر تمنع البيانات الشاذة من تلويث المحاكاة:
#   - RVOL شاذ (>20×) يحدث عندما يكون متوسط حجم 20 يوم ≈ 0 (سهم نائم فجأة يتحرك)
#   - Penny stocks (<1 EGP) تُظهر تقلبات غير واقعية
#   - متوسط حجم منخفض (<10,000) يعني السهم غير سائل فعلياً
RVOL_CAP = 20.0  # حد أقصى للـ RVOL (تجنب القيم الشاذة)
MIN_PRICE_EGP = 1.0  # تجنب penny stocks
MIN_AVG_VOLUME_20 = 10_000.0  # متوسط حجم 20 يوم أدنى (سيولة حقيقية)


# ════════════════════════════════════════════════════════════════════════════
# 1. تحميل البيانات
# ════════════════════════════════════════════════════════════════════════════
def load_price_history(db_path: str) -> Dict[str, List[dict]]:
    """حمّل كل price_history في الذاكرة، مجمّع حسب ticker.

    Returns:
        {ticker: [{date, open, high, low, close, volume}, ...]} مرتب حسب التاريخ.
    """
    print(f"📦 Loading price history from {db_path}...")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        """
        SELECT ticker, date, open_price, high_price, low_price, close_price, volume
        FROM price_history
        WHERE volume IS NOT NULL AND volume >= 0
          AND open_price > 0 AND high_price > 0 AND low_price > 0 AND close_price > 0
        ORDER BY ticker, date ASC
        """
    )
    by_ticker: Dict[str, List[dict]] = defaultdict(list)
    total_rows = 0
    for row in cur:
        by_ticker[row["ticker"]].append(
            {
                "date": row["date"],
                "open": float(row["open_price"]),
                "high": float(row["high_price"]),
                "low": float(row["low_price"]),
                "close": float(row["close_price"]),
                "volume": float(row["volume"] or 0),
            }
        )
        total_rows += 1
    conn.close()
    print(f"   ✅ Loaded {total_rows:,} rows for {len(by_ticker):,} tickers")
    return dict(by_ticker)


def get_trading_days(by_ticker: Dict[str, List[dict]]) -> List[str]:
    """اجمع كل أيام التداول المرتبة."""
    days = set()
    for rows in by_ticker.values():
        for r in rows:
            days.add(r["date"])
    return sorted(days)


# ════════════════════════════════════════════════════════════════════════════
# 2. المؤشرات الفنية
# ════════════════════════════════════════════════════════════════════════════
def calc_atr(rows: List[dict], idx: int, period: int = 14) -> float:
    """ATR (Average True Range) لآخر `period` يوم حتى idx."""
    if idx < 1 or idx >= len(rows):
        return 0.0
    trs = []
    start = max(1, idx - period + 1)
    for i in range(start, idx + 1):
        h = rows[i]["high"]
        l = rows[i]["low"]
        pc = rows[i - 1]["close"]
        tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
    if not trs:
        return 0.0
    return sum(trs) / len(trs)


def calc_sma(rows: List[dict], idx: int, period: int = 20) -> Optional[float]:
    """SMA لآخر `period` يوم حتى idx."""
    if idx < period - 1:
        return None
    start = idx - period + 1
    closes = [rows[i]["close"] for i in range(start, idx + 1)]
    return sum(closes) / len(closes)


def calc_rsi(rows: List[dict], idx: int, period: int = 14) -> Optional[float]:
    """RSI(14)."""
    if idx < period:
        return None
    gains = []
    losses = []
    for i in range(idx - period + 1, idx + 1):
        ch = rows[i]["close"] - rows[i - 1]["close"]
        gains.append(max(0, ch))
        losses.append(max(0, -ch))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def calc_rvol(rows: List[dict], idx: int, period: int = 20) -> float:
    """RVOL = volume[idx] / mean(volume[idx-period..idx-1])."""
    if idx < period:
        return 1.0
    vols = [rows[i]["volume"] for i in range(idx - period, idx)]
    avg = sum(vols) / len(vols)
    if avg <= 0:
        return 1.0
    return rows[idx]["volume"] / avg


def calc_atr_stop_pct(atr: float, price: float) -> float:
    """ATR-based stop في نطاق [3%, 9%] (Rule 8)."""
    if price <= 0:
        return ATR_STOP_MIN_PCT
    raw = atr / price
    return max(ATR_STOP_MIN_PCT, min(ATR_STOP_MAX_PCT, raw))


def calc_continuation_state(
    rows: List[dict], idx: int
) -> Tuple[str, float, float, float]:
    """حالة استمرار مبسّطة (نفس فلسفة compute_continuation_metrics).

    Returns:
        (state, prob_up, prob_mild, prob_drop) — مجموع الاحتمالات = 1.0
        state: 'continuing' | 'weakening' | 'exhausted'
    """
    if idx < 5:
        return ("continuing", 0.55, 0.30, 0.15)

    # آخر 3 قمم + 3 قيعان
    recent_highs = [rows[i]["high"] for i in range(max(0, idx - 5), idx + 1)]
    recent_lows = [rows[i]["low"] for i in range(max(0, idx - 5), idx + 1)]
    higher_highs = (
        len(recent_highs) >= 3
        and recent_highs[-1] > recent_highs[-2] > recent_highs[-3]
    )
    higher_lows = (
        len(recent_lows) >= 3
        and recent_lows[-1] > recent_lows[-2] > recent_lows[-3]
    )

    # امتداد من القمة
    cur_close = rows[idx]["close"]
    max_high = max(recent_highs)
    pct_from_high = ((max_high - cur_close) / max_high) * 100 if max_high > 0 else 0

    # حجم مؤكد
    recent_vols = [rows[i]["volume"] for i in range(max(0, idx - 5), idx + 1)]
    avg_vol_5 = sum(recent_vols) / len(recent_vols) if recent_vols else 0
    avg_vol_20_arr = [rows[i]["volume"] for i in range(max(0, idx - 20), idx + 1)]
    avg_vol_20 = sum(avg_vol_20_arr) / len(avg_vol_20_arr) if avg_vol_20_arr else 1
    volume_confirming = avg_vol_5 >= 0.8 * avg_vol_20

    # RSI للزخم
    rsi = calc_rsi(rows, idx, 14)

    # القرار
    momentum_alive = (higher_highs or higher_lows) and pct_from_high <= 5.0 and volume_confirming

    if momentum_alive and (rsi is None or rsi < 75):
        state = "continuing"
        prob_up = 0.62
        prob_mild = 0.25
        prob_drop = 0.13
    elif momentum_alive and rsi is not None and rsi >= 75:
        # زخم قوي لكن يشير للاستنزاف
        state = "weakening"
        prob_up = 0.42
        prob_mild = 0.35
        prob_drop = 0.23
    elif pct_from_high > 8.0 or (rsi is not None and rsi < 45):
        state = "exhausted"
        prob_up = 0.22
        prob_mild = 0.38
        prob_drop = 0.40
    else:
        state = "weakening"
        prob_up = 0.45
        prob_mild = 0.35
        prob_drop = 0.20

    # تطبيع
    total = prob_up + prob_mild + prob_drop
    return (state, prob_up / total, prob_mild / total, prob_drop / total)


# ════════════════════════════════════════════════════════════════════════════
# 3. مسح المرشحين لليوم
# ════════════════════════════════════════════════════════════════════════════
def scan_morning_bell_candidates(
    by_ticker: Dict[str, List[dict]],
    date_to_idx: Dict[str, Dict[str, int]],
    day: str,
    rvol_threshold: float = MORNING_BELL_RVOL_THRESHOLD,
    min_extension_pct: float = MORNING_BELL_MIN_EXTENSION_PCT,
    max_picks: int = MORNING_BELL_MAX_PICKS,
) -> List[dict]:
    """امسح كل الأسهم ليوم `day` وطبّق بوابة جرس الصباح.

    P41-HIST-CORR: يقبل overrides للعتبات (لتحليل الحساسية).
    """
    candidates = []
    for ticker, rows in by_ticker.items():
        idx_map = date_to_idx.get(ticker)
        if not idx_map:
            continue
        idx = idx_map.get(day)
        if idx is None or idx < WARMUP_DAYS:
            continue
        row = rows[idx]

        # سيولة (Rule 13): volume * close >= 500K EGP
        turnover = row["volume"] * row["close"]
        if turnover < MIN_TURNOVER_EGP:
            continue

        # فلتر السعر الأدنى (تجنب penny stocks)
        if row["close"] < MIN_PRICE_EGP:
            continue

        # متوسط حجم 20 يوم (سيولة حقيقية)
        vols_20 = [rows[i]["volume"] for i in range(max(0, idx - 20), idx)]
        avg_vol_20 = sum(vols_20) / len(vols_20) if vols_20 else 0
        if avg_vol_20 < MIN_AVG_VOLUME_20:
            continue

        # RVOL
        rvol = calc_rvol(rows, idx, 20)
        if rvol < rvol_threshold:
            continue
        # فلتر RVOL الشاذ (cap لتفادي القيم غير المنطقية)
        rvol_raw = rvol
        rvol = min(rvol, RVOL_CAP)

        # امتداد يومي (open → close)
        ext = ((row["close"] - row["open"]) / row["open"]) * 100 if row["open"] > 0 else 0
        if ext < min_extension_pct:
            continue

        # ATR + stop
        atr = calc_atr(rows, idx, 14)
        stop_pct = calc_atr_stop_pct(atr, row["close"])
        r_distance = stop_pct * row["close"]

        # continuation
        state, p_up, p_mild, p_drop = calc_continuation_state(rows, idx)

        # composite score (نفس _get_morning_bell_live)
        rvol_norm = min(rvol, 5.0) / 5.0 * 100
        ext_norm = min(abs(ext), 10.0) / 10.0 * 100
        cont_map = {"continuing": 100, "weakening": 55, "exhausted": 20}
        cont_score = cont_map.get(state, 50)
        liq_norm = min(turnover, 5_000_000) / 5_000_000 * 100
        composite = (
            MORNING_BELL_W_RVOL * rvol_norm
            + MORNING_BELL_W_EXT * ext_norm
            + MORNING_BELL_W_CONT * cont_score
            + MORNING_BELL_W_LIQ * liq_norm
        )

        candidates.append(
            {
                "ticker": ticker,
                "date": day,
                "entry_price": row["close"],
                "open": row["open"],
                "high": row["high"],
                "low": row["low"],
                "close": row["close"],
                "volume": row["volume"],
                "turnover_egp": turnover,
                "rvol": rvol,
                "rvol_raw": rvol_raw,
                "avg_vol_20": avg_vol_20,
                "extension_pct_day": ext,
                "continuation_state": state,
                "prob_continue_up": p_up,
                "prob_mild_pullback": p_mild,
                "prob_sharp_drop": p_drop,
                "atr": atr,
                "atr_stop_pct": stop_pct,
                "r_distance": r_distance,
                "tp1": row["close"] + TP1_R_MULT * r_distance,
                "tp2": row["close"] + TP2_R_MULT * r_distance,
                "stop": row["close"] - r_distance,
                "composite_score": composite,
                "idx": idx,
            }
        )

    # ترتيب تنازلي حسب composite score
    candidates.sort(key=lambda x: x["composite_score"], reverse=True)
    return candidates[:MORNING_BELL_MAX_PICKS]


# ════════════════════════════════════════════════════════════════════════════
# 4. محاكاة الخروج (TP/SL/Partial)
# ════════════════════════════════════════════════════════════════════════════
def simulate_exit(
    rows: List[dict], entry_idx: int, pick: dict
) -> dict:
    """محاكاة خروج التوصية عبر آفاق 0/1/3/5 أيام مع TP1/TP2/Stop.

    Entry = close[entry_idx] (proxy for end-of-day entry).
    Stop = entry - r_distance
    TP1 = entry + 1.5R (partial 50% + raise stop to breakeven)
    TP2 = entry + 3R (full exit)

    Returns dict with:
        exit_type, exit_price, holding_days, actual_return,
        hit_tp1, hit_tp2, hit_stop, raw returns at H=0/1/3/5
    """
    entry = pick["entry_price"]
    stop = pick["stop"]
    tp1 = pick["tp1"]
    tp2 = pick["tp2"]
    r_distance = pick["r_distance"]
    n = len(rows)

    # ── العوائد الخام عند الآفاق (بدون TP/SL) ────────────────────────────────
    raw_returns = {"h0": 0.0, "h1": None, "h3": None, "h5": None}
    # H=0: open → close لنفس اليوم (mid-day momentum proxy)
    raw_returns["h0"] = ((pick["close"] - pick["open"]) / pick["open"]) * 100 if pick["open"] > 0 else 0
    for h, key in [(1, "h1"), (3, "h3"), (5, "h5")]:
        k = entry_idx + h
        if k < n:
            raw_returns[key] = ((rows[k]["close"] - entry) / entry) * 100
        else:
            raw_returns[key] = None

    # ── محاكاة TP/SL/Partial walk-forward ────────────────────────────────────
    exit_type = "expired"
    exit_price = entry
    holding_days = HOLDING_MAX_DAYS
    hit_tp1 = False
    hit_tp2 = False
    hit_stop = False
    partial_done = False
    current_stop = stop
    weighted_return = 0.0  # العائد الموزون (50% at TP1 + 50% at TP2/stop/expiry)

    max_k = min(entry_idx + HOLDING_MAX_DAYS, n - 1)

    for k in range(entry_idx + 1, max_k + 1):
        day = rows[k]
        # افترض: stop يتحقق قبل TP في نفس اليوم (conservative)
        if day["low"] <= current_stop:
            exit_type = "stop_loss"
            exit_price = current_stop
            holding_days = k - entry_idx
            hit_stop = True
            # لو partial_done، النصف الأول خرج عند TP1 (ربح 1.5R)، النصف الثاني خرج عند current_stop
            if partial_done:
                # current_stop = breakeven (entry) → return = 0 للنصف الثاني
                weighted_return = (
                    0.5 * ((tp1 - entry) / entry) * 100
                    + 0.5 * ((current_stop - entry) / entry) * 100
                )
            else:
                weighted_return = ((current_stop - entry) / entry) * 100
            break

        if day["high"] >= tp2:
            exit_type = "tp2_hit"
            exit_price = tp2
            holding_days = k - entry_idx
            hit_tp2 = True
            hit_tp1 = True  # TP1 يجب أن يُلمس قبل TP2
            partial_done = True
            # 50% at TP1 (1.5R) + 50% at TP2 (3R) → weighted = 2.25R
            weighted_return = (
                0.5 * ((tp1 - entry) / entry) * 100
                + 0.5 * ((tp2 - entry) / entry) * 100
            )
            break

        if day["high"] >= tp1 and not partial_done:
            hit_tp1 = True
            partial_done = True
            # ارفع الوقف لـ breakeven (Rule 9 — trailing = floor, not cap)
            current_stop = entry
            # سجّل partial exit عند TP1 (50%)
            partial_return = ((tp1 - entry) / entry) * 100
            # استمر لمحاولة TP2 أو انتهاء الأفق

    # لو ما خرجش، اخلع عند close[max_k]
    if exit_type == "expired":
        exit_price = rows[max_k]["close"]
        holding_days = max_k - entry_idx
        if partial_done:
            # 50% at TP1 (1.5R) + 50% at expiry
            weighted_return = (
                0.5 * ((tp1 - entry) / entry) * 100
                + 0.5 * ((exit_price - entry) / entry) * 100
            )
        else:
            weighted_return = ((exit_price - entry) / entry) * 100

    # HARD cap (Rule 7)
    weighted_return = max(-HARD_RETURN_CAP, min(HARD_RETURN_CAP, weighted_return))

    return {
        "exit_type": exit_type,
        "exit_price": round(exit_price, 4),
        "holding_days": holding_days,
        "actual_return": round(weighted_return, 4),
        "hit_tp1": hit_tp1,
        "hit_tp2": hit_tp2,
        "hit_stop": hit_stop,
        "partial_done": partial_done,
        "raw_returns": raw_returns,
    }


# ════════════════════════════════════════════════════════════════════════════
# 5. حساب الإحصائيات
# ════════════════════════════════════════════════════════════════════════════
def compute_metrics(trades: List[dict]) -> dict:
    """احسب n, WR, PF, Expectancy, Max loss, MaxDD, avg days."""
    if not trades:
        return {
            "n_trades": 0,
            "win_rate": 0,
            "profit_factor": 0,
            "expectancy": 0,
            "max_loss": 0,
            "max_win": 0,
            "max_drawdown": 0,
            "avg_holding_days": 0,
            "gross_profit": 0,
            "gross_loss": 0,
            "tp1_hit_rate": 0,
            "tp2_hit_rate": 0,
            "stop_hit_rate": 0,
        }

    returns = [t["actual_return"] for t in trades]
    wins = [r for r in returns if r > 0]
    losses = [r for r in returns if r < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    n = len(trades)
    wr = (len(wins) / n) * 100 if n else 0
    pf = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)
    expectancy = sum(returns) / n if n else 0
    max_loss = min(returns) if returns else 0
    max_win = max(returns) if returns else 0

    # Max Drawdown من السلسلة التراكمية
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

    avg_days = sum(t["holding_days"] for t in trades) / n if n else 0
    tp1_hits = sum(1 for t in trades if t["hit_tp1"])
    tp2_hits = sum(1 for t in trades if t["hit_tp2"])
    stop_hits = sum(1 for t in trades if t["hit_stop"])

    return {
        "n_trades": n,
        "win_rate": round(wr, 2),
        "profit_factor": round(pf, 3),
        "expectancy": round(expectancy, 4),
        "max_loss": round(max_loss, 4),
        "max_win": round(max_win, 4),
        "max_drawdown": round(max_dd, 4),
        "avg_holding_days": round(avg_days, 2),
        "gross_profit": round(gross_profit, 4),
        "gross_loss": round(gross_loss, 4),
        "tp1_hit_rate": round((tp1_hits / n) * 100, 2),
        "tp2_hit_rate": round((tp2_hits / n) * 100, 2),
        "stop_hit_rate": round((stop_hits / n) * 100, 2),
    }


def compute_raw_horizon_metrics(trades: List[dict]) -> dict:
    """احسب العوائد الخام عند الآفاق 0/1/3/5 (بدون TP/SL)."""
    out = {}
    for h_key, label in [("h0", "same_day_close"), ("h1", "plus_1_day"), ("h3", "plus_3_days"), ("h5", "plus_5_days")]:
        vals = [t["raw_returns"][h_key] for t in trades if t["raw_returns"].get(h_key) is not None]
        if not vals:
            out[label] = {"n": 0}
            continue
        wins = [v for v in vals if v > 0]
        losses = [v for v in vals if v < 0]
        gp = sum(wins)
        gl = abs(sum(losses))
        n = len(vals)
        out[label] = {
            "n": n,
            "win_rate": round((len(wins) / n) * 100, 2),
            "profit_factor": round((gp / gl) if gl > 0 else (999.0 if gp > 0 else 0.0), 3),
            "expectancy": round(sum(vals) / n, 4),
            "avg_return": round(sum(vals) / n, 4),
            "max_loss": round(min(vals), 4),
            "max_win": round(max(vals), 4),
        }
    return out


# ════════════════════════════════════════════════════════════════════════════
# 6. تشغيل المحاكاة الكاملة
# ════════════════════════════════════════════════════════════════════════════
def run_backtest(
    by_ticker: Dict[str, List[dict]],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    rvol_threshold: float = MORNING_BELL_RVOL_THRESHOLD,
    min_extension_pct: float = MORNING_BELL_MIN_EXTENSION_PCT,
    max_picks: int = MORNING_BELL_MAX_PICKS,
    verbose: bool = True,
) -> dict:
    """شغّل المحاكاة التاريخية الكاملة.

    P41-HIST-CORR: يقبل overrides للعتبات (لتحليل الحساسية) + verbose flag.
    """
    trading_days = get_trading_days(by_ticker)
    if start_date:
        trading_days = [d for d in trading_days if d >= start_date]
    if end_date:
        trading_days = [d for d in trading_days if d <= end_date]

    if verbose:
        print(f"📅 Trading days in range: {len(trading_days)}")
        print(f"   from {trading_days[0] if trading_days else 'N/A'} to {trading_days[-1] if trading_days else 'N/A'}")
        print(f"   RVOL≥{rvol_threshold}, ext≥{min_extension_pct}%, max_picks={max_picks}")

    # ابنِ فهرس التاريخ → idx لكل سهم (للتسريع)
    if verbose:
        print("🏗️  Building date→idx index per ticker...")
    date_to_idx: Dict[str, Dict[str, int]] = {}
    for ticker, rows in by_ticker.items():
        date_to_idx[ticker] = {r["date"]: i for i, r in enumerate(rows)}
    if verbose:
        print(f"   ✅ Indexed {len(date_to_idx):,} tickers")

    all_trades: List[dict] = []
    days_with_picks = 0
    total_picks = 0

    if verbose:
        print(f"🔍 Scanning {len(trading_days)} days × {len(by_ticker):,} tickers...")
    for i, day in enumerate(trading_days):
        if i < WARMUP_DAYS:
            continue
        picks = scan_morning_bell_candidates(
            by_ticker, date_to_idx, day,
            rvol_threshold=rvol_threshold,
            min_extension_pct=min_extension_pct,
            max_picks=max_picks,
        )
        if not picks:
            continue
        days_with_picks += 1
        total_picks += len(picks)

        for pick in picks:
            rows = by_ticker[pick["ticker"]]
            entry_idx = pick["idx"]
            exit_result = simulate_exit(rows, entry_idx, pick)
            trade = {
                **{k: v for k, v in pick.items() if k != "idx"},
                **exit_result,
                "channel": "morning_bell_historical",
                "stats_separated": True,
            }
            all_trades.append(trade)

        if (i + 1) % 50 == 0:
            print(f"   ... day {i+1}/{len(trading_days)} — picks so far: {len(all_trades)}")

    print(f"\n✅ Scan complete:")
    print(f"   Days with picks: {days_with_picks}")
    print(f"   Total trades simulated: {len(all_trades)}")

    # ── الإحصائيات ───────────────────────────────────────────────────────────
    metrics = compute_metrics(all_trades)
    raw_horizons = compute_raw_horizon_metrics(all_trades)

    # ── أفضل/أسوأ 20 ──────────────────────────────────────────────────────────
    sorted_by_return = sorted(all_trades, key=lambda x: x["actual_return"])
    worst_20 = sorted_by_return[:20]
    best_20 = sorted_by_return[-20:][::-1]

    # ── توزيع حالات الاستمرار ─────────────────────────────────────────────────
    cont_dist = defaultdict(int)
    for t in all_trades:
        cont_dist[t["continuation_state"]] += 1

    # ── توزيع exit types ──────────────────────────────────────────────────────
    exit_dist = defaultdict(int)
    for t in all_trades:
        exit_dist[t["exit_type"]] += 1

    # ── العائد الشهري ─────────────────────────────────────────────────────────
    monthly_returns: Dict[str, List[float]] = defaultdict(list)
    for t in all_trades:
        month_key = t["date"][:7]  # YYYY-MM
        monthly_returns[month_key].append(t["actual_return"])
    monthly_summary = {
        m: {
            "n_trades": len(rs),
            "win_rate": round((len([r for r in rs if r > 0]) / len(rs)) * 100, 2),
            "avg_return": round(sum(rs) / len(rs), 4),
            "total_return": round(sum(rs), 4),
        }
        for m, rs in sorted(monthly_returns.items())
    }

    result = {
        "metadata": {
            "archive": "active_databases_20260817_full.zip",
            "archive_md5": "0947bdf6c2eff1a75ff8af6c3e576ed8",
            "db_path": PRICE_HISTORY_DB,
            "run_at": datetime.now(timezone.utc).isoformat() + "Z",
            "date_range": {
                "start": trading_days[0] if trading_days else None,
                "end": trading_days[-1] if trading_days else None,
            },
            "trading_days_scanned": len(trading_days),
            "total_tickers_in_db": len(by_ticker),
            "channel": "morning_bell_historical",
            "stats_separated": True,
            "rules_applied": {
                "rule_7_hard_cap": f"ABS(actual_return) <= {HARD_RETURN_CAP}",
                "rule_8_atr_stop_range": f"[{ATR_STOP_MIN_PCT*100}%, {ATR_STOP_MAX_PCT*100}%]",
                "rule_13_min_turnover_egp": MIN_TURNOVER_EGP,
                "rr_floor": RR_FLOOR,
                "tp1_r_mult": TP1_R_MULT,
                "tp2_r_mult": TP2_R_MULT,
                "partial_exit_pct": PARTIAL_EXIT_PCT,
            },
            "settings": {
                "max_picks_per_day": MORNING_BELL_MAX_PICKS,
                "rvol_threshold": MORNING_BELL_RVOL_THRESHOLD,
                "min_extension_pct": MORNING_BELL_MIN_EXTENSION_PCT,
                "composite_weights": {
                    "rvol": MORNING_BELL_W_RVOL,
                    "extension": MORNING_BELL_W_EXT,
                    "continuation": MORNING_BELL_W_CONT,
                    "liquidity": MORNING_BELL_W_LIQ,
                },
                "holding_max_days": HOLDING_MAX_DAYS,
                "warmup_days": WARMUP_DAYS,
            },
            "data_quality_filters": {
                "rvol_cap": RVOL_CAP,
                "min_price_egp": MIN_PRICE_EGP,
                "min_avg_volume_20": MIN_AVG_VOLUME_20,
                "description": (
                    "فلاتر لمنع البيانات الشاذة: RVOL cap يمنع الأسهم النائمة التي فجرت فجأة، "
                    "min_price يتجنب penny stocks، min_avg_volume يتجنب الأسهم غير السائلة فعلياً."
                ),
            },
        },
        "summary": {
            "days_with_picks": days_with_picks,
            "total_trades": len(all_trades),
            "avg_picks_per_active_day": round(total_picks / days_with_picks, 2) if days_with_picks else 0,
            "continuation_distribution": dict(cont_dist),
            "exit_type_distribution": dict(exit_dist),
        },
        "metrics": metrics,
        "raw_horizon_metrics": raw_horizons,
        "monthly_breakdown": monthly_summary,
        "worst_20_trades": [
            {
                "ticker": t["ticker"],
                "date": t["date"],
                "entry": t["entry_price"],
                "exit_price": t["exit_price"],
                "return_pct": t["actual_return"],
                "exit_type": t["exit_type"],
                "holding_days": t["holding_days"],
                "rvol": round(t["rvol"], 2),
                "extension_pct_day": round(t["extension_pct_day"], 2),
                "continuation_state": t["continuation_state"],
                "composite_score": round(t["composite_score"], 1),
            }
            for t in worst_20
        ],
        "best_20_trades": [
            {
                "ticker": t["ticker"],
                "date": t["date"],
                "entry": t["entry_price"],
                "exit_price": t["exit_price"],
                "return_pct": t["actual_return"],
                "exit_type": t["exit_type"],
                "holding_days": t["holding_days"],
                "rvol": round(t["rvol"], 2),
                "extension_pct_day": round(t["extension_pct_day"], 2),
                "continuation_state": t["continuation_state"],
                "composite_score": round(t["composite_score"], 1),
            }
            for t in best_20
        ],
        "all_trades_count": len(all_trades),
        "disclaimer": (
            "هذه المحاكاة منفصلة تماماً عن إحصائيات balanced/conservative. "
            "channel=morning_bell_historical، لا تُكتب في predictions DB. "
            "العوائد capped عند ±50% (Rule 7)."
        ),
    }

    return result


# ════════════════════════════════════════════════════════════════════════════
# 7. توليد تقرير Markdown
# ════════════════════════════════════════════════════════════════════════════
def generate_markdown_report(result: dict) -> str:
    """ولّد تقرير Markdown قابل للقراءة."""
    m = result["metadata"]
    s = result["summary"]
    k = result["metrics"]
    rh = result["raw_horizon_metrics"]
    md = []
    md.append("# 🔔 محاكاة تاريخية لجرس الصباح (Morning Bell Historical Backtest)\n")
    md.append(f"> **القناة:** `{m['channel']}` — منفصل تماماً عن balanced/conservative\n")
    md.append(f"> **الأرشيف:** `{m['archive']}` (MD5: `{m['archive_md5']}`)\n")
    md.append(f"> **التشغيل:** {m['run_at']}\n")
    md.append(f"> **DB:** `{m['db_path']}`\n\n")

    md.append("## 📊 الملخص التنفيذي\n")
    md.append(f"| البيان | القيمة |")
    md.append(f"|--------|--------|")
    md.append(f"| الفترة | {m['date_range']['start']} → {m['date_range']['end']} |")
    md.append(f"| أيام التداول الممسوحة | {m['trading_days_scanned']} |")
    md.append(f"| الأسهم في DB | {m['total_tickers_in_db']:,} |")
    md.append(f"| أيام بها توصيات | {s['days_with_picks']} |")
    md.append(f"| إجمالي الصفقات | **{s['total_trades']}** |")
    md.append(f"| متوسط التوصيات/يوم نشط | {s['avg_picks_per_active_day']} |")
    md.append("")

    md.append("## 🎯 الإحصائيات الأساسية (مع TP/SL/Partial)\n")
    md.append(f"| المؤشر | القيمة |")
    md.append(f"|---------|--------|")
    md.append(f"| **عدد الصفقات (n)** | **{k['n_trades']}** |")
    md.append(f"| **Win Rate %** | **{k['win_rate']}%** |")
    md.append(f"| **Profit Factor** | **{k['profit_factor']}** |")
    md.append(f"| **Expectancy (متوسط العائد/صفقة)** | **{k['expectancy']}%** |")
    md.append(f"| **Max Loss** | {k['max_loss']}% |")
    md.append(f"| **Max Win** | {k['max_win']}% |")
    md.append(f"| **Max Drawdown** | {k['max_drawdown']}% |")
    md.append(f"| **متوسط أيام الاحتجاز** | {k['avg_holding_days']} |")
    md.append(f"| Gross Profit | {k['gross_profit']} |")
    md.append(f"| Gross Loss | {k['gross_loss']} |")
    md.append(f"| TP1 Hit Rate | {k['tp1_hit_rate']}% |")
    md.append(f"| TP2 Hit Rate | {k['tp2_hit_rate']}% |")
    md.append(f"| Stop Hit Rate | {k['stop_hit_rate']}% |")
    md.append("")

    md.append("## 📈 العوائد الخام عند الآفاق (بدون TP/SL)\n")
    md.append("هذا يُظهر ما يحدث لو احتفظنا بالسهم دون أي خروج آلي (للمقارنة فقط).\n")
    md.append(f"| الأفق | n | Win Rate % | Profit Factor | Expectancy % | Max Loss % | Max Win % |")
    md.append(f"|-------|---|------------|---------------|--------------|------------|-----------|")
    horizon_labels = [
        ("same_day_close", "نفس اليوم (open→close)"),
        ("plus_1_day", "+1 يوم"),
        ("plus_3_days", "+3 أيام"),
        ("plus_5_days", "+5 أيام"),
    ]
    for key, label in horizon_labels:
        h = rh.get(key, {})
        if h.get("n", 0) == 0:
            md.append(f"| {label} | 0 | - | - | - | - | - |")
        else:
            md.append(
                f"| {label} | {h['n']} | {h['win_rate']}% | {h['profit_factor']} | "
                f"{h['expectancy']}% | {h['max_loss']}% | {h['max_win']}% |"
            )
    md.append("")

    md.append("## 🧪 توزيع حالات الاستمرار\n")
    cont = s["continuation_distribution"]
    total_cont = sum(cont.values()) or 1
    md.append(f"| الحالة | العدد | النسبة % |")
    md.append(f"|--------|------|----------|")
    for state in ["continuing", "weakening", "exhausted"]:
        c = cont.get(state, 0)
        md.append(f"| {state} | {c} | {round((c/total_cont)*100, 2)}% |")
    md.append("")

    md.append("## 🚪 توزيع أنواع الخروج\n")
    exits = s["exit_type_distribution"]
    total_exits = sum(exits.values()) or 1
    md.append(f"| النوع | العدد | النسبة % |")
    md.append(f"|-------|------|----------|")
    for et in ["tp2_hit", "tp1_hit", "stop_loss", "expired"]:
        c = exits.get(et, 0)
        md.append(f"| {et} | {c} | {round((c/total_exits)*100, 2)}% |")
    md.append("")

    md.append("## 📅 التحليل الشهري\n")
    md.append(f"| الشهر | n | Win Rate % | متوسط العائد % | إجمالي العائد % |")
    md.append(f"|-------|---|------------|----------------|------------------|")
    for month, ms in result["monthly_breakdown"].items():
        md.append(f"| {month} | {ms['n_trades']} | {ms['win_rate']}% | {ms['avg_return']}% | {ms['total_return']}% |")
    md.append("")

    md.append("## 🏆 أفضل 20 صفقة\n")
    md.append(f"| # | Ticker | التاريخ | Entry | Exit | Return % | Exit Type | Days | RVOL | Ext % | Continuation | Score |")
    md.append(f"|---|--------|---------|-------|------|----------|-----------|------|------|-------|--------------|-------|")
    for i, t in enumerate(result["best_20_trades"], 1):
        md.append(
            f"| {i} | {t['ticker']} | {t['date']} | {t['entry']:.2f} | {t['exit_price']:.2f} | "
            f"**+{t['return_pct']:.2f}%** | {t['exit_type']} | {t['holding_days']} | "
            f"{t['rvol']} | {t['extension_pct_day']} | {t['continuation_state']} | {t['composite_score']} |"
        )
    md.append("")

    md.append("## 💀 أسوأ 20 صفقة\n")
    md.append(f"| # | Ticker | التاريخ | Entry | Exit | Return % | Exit Type | Days | RVOL | Ext % | Continuation | Score |")
    md.append(f"|---|--------|---------|-------|------|----------|-----------|------|------|-------|--------------|-------|")
    for i, t in enumerate(result["worst_20_trades"], 1):
        md.append(
            f"| {i} | {t['ticker']} | {t['date']} | {t['entry']:.2f} | {t['exit_price']:.2f} | "
            f"**{t['return_pct']:.2f}%** | {t['exit_type']} | {t['holding_days']} | "
            f"{t['rvol']} | {t['extension_pct_day']} | {t['continuation_state']} | {t['composite_score']} |"
        )
    md.append("")

    md.append("## ⚙️ القواعد المطبقة (CONSTITUTION)\n")
    rules = m["rules_applied"]
    md.append(f"- **Rule 7 (HARD cap):** {rules['rule_7_hard_cap']}")
    md.append(f"- **Rule 8 (ATR stop range):** {rules['rule_8_atr_stop_range']}")
    md.append(f"- **Rule 13 (Min turnover):** {rules['rule_13_min_turnover_egp']:,.0f} EGP")
    md.append(f"- **R:R floor:** {rules['rr_floor']}")
    md.append(f"- **TP1:** {rules['tp1_r_mult']}R (partial {rules['partial_exit_pct']*100:.0f}% + raise stop to breakeven)")
    md.append(f"- **TP2:** {rules['tp2_r_mult']}R (full exit)")
    md.append("")
    md.append("## 🔧 الإعدادات\n")
    settings = m["settings"]
    md.append(f"- **Max picks/day:** {settings['max_picks_per_day']}")
    md.append(f"- **RVOL threshold:** {settings['rvol_threshold']}×")
    md.append(f"- **Min extension:** {settings['min_extension_pct']}%")
    md.append(f"- **Composite weights:** RVOL={settings['composite_weights']['rvol']}, Ext={settings['composite_weights']['extension']}, Cont={settings['composite_weights']['continuation']}, Liq={settings['composite_weights']['liquidity']}")
    md.append(f"- **Holding max days:** {settings['holding_max_days']}")
    md.append(f"- **Warmup days:** {settings['warmup_days']}")
    md.append("")

    md.append("## 🧹 فلاتر جودة البيانات\n")
    dqf = m.get("data_quality_filters", {})
    md.append(f"- **RVOL cap:** {dqf.get('rvol_cap', 'N/A')}× (تجنب القيم الشاذة)")
    md.append(f"- **Min price:** {dqf.get('min_price_egp', 'N/A')} EGP (تجنب penny stocks)")
    md.append(f"- **Min avg volume (20d):** {dqf.get('min_avg_volume_20', 'N/A'):,} (سيولة حقيقية)")
    md.append(f"\n> {dqf.get('description', '')}")
    md.append("")

    md.append("## 🛡️ فصل الإحصائيات\n")
    md.append(result["disclaimer"])
    md.append("")
    md.append("---")
    md.append(f"\n*تم التشغيل بواسطة Z.ai Code — {datetime.now(timezone.utc).isoformat()}Z*")

    return "\n".join(md)


# ════════════════════════════════════════════════════════════════════════════
# 8. Entry point
# ════════════════════════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser(description="Morning Bell Historical Backtest")
    parser.add_argument("--start", default=None, help="Start date YYYY-MM-DD")
    parser.add_argument("--end", default=None, help="End date YYYY-MM-DD")
    args = parser.parse_args()

    print("=" * 70)
    print("🔔 Morning Bell Historical Backtest (P41-HIST-SIM)")
    print("=" * 70)
    print(f"📁 Archive: active_databases_20260817_full.zip")
    print(f"🗄️  DB: {PRICE_HISTORY_DB}")
    print(f"📅 Range: {args.start or '2025-01-09'} → {args.end or '2026-08-17'}")
    print(f"⚙️  Rules: RVOL≥{MORNING_BELL_RVOL_THRESHOLD}, Ext≥{MORNING_BELL_MIN_EXTENSION_PCT}%, "
          f"Top {MORNING_BELL_MAX_PICKS}/day, ATR stop [{ATR_STOP_MIN_PCT*100}%-{ATR_STOP_MAX_PCT*100}%]")
    print("=" * 70)

    # تحقق من وجود DB
    if not os.path.exists(PRICE_HISTORY_DB):
        print(f"❌ DB not found: {PRICE_HISTORY_DB}")
        sys.exit(1)

    # حمّل البيانات
    by_ticker = load_price_history(PRICE_HISTORY_DB)
    if not by_ticker:
        print("❌ No data loaded")
        sys.exit(1)

    # شغّل المحاكاة
    result = run_backtest(by_ticker, start_date=args.start, end_date=args.end)

    # احفظ JSON
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n💾 JSON saved: {OUTPUT_JSON}")

    # احفظ Markdown
    md_report = generate_markdown_report(result)
    with open(OUTPUT_MD, "w", encoding="utf-8") as f:
        f.write(md_report)
    print(f"📄 Markdown saved: {OUTPUT_MD}")

    # اطبع الملخص
    print("\n" + "=" * 70)
    print("📋 SUMMARY")
    print("=" * 70)
    k = result["metrics"]
    print(f"  n_trades:        {k['n_trades']}")
    print(f"  Win Rate:        {k['win_rate']}%")
    print(f"  Profit Factor:   {k['profit_factor']}")
    print(f"  Expectancy:      {k['expectancy']}%")
    print(f"  Max Loss:        {k['max_loss']}%")
    print(f"  Max Win:         {k['max_win']}%")
    print(f"  Max Drawdown:    {k['max_drawdown']}%")
    print(f"  Avg Hold Days:   {k['avg_holding_days']}")
    print(f"  TP1 Hit Rate:    {k['tp1_hit_rate']}%")
    print(f"  TP2 Hit Rate:    {k['tp2_hit_rate']}%")
    print(f"  Stop Hit Rate:   {k['stop_hit_rate']}%")
    print("=" * 70)


if __name__ == "__main__":
    main()

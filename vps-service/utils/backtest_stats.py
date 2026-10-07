"""
utils/backtest_stats.py — Canonical Backtest Statistics (Win Rate + Profit Factor)
====================================================================================
**Rule 54 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب WR + PF في المشروع.

الـ canonical functions:
  - compute_win_rate(closed_trades) — wins / total × 100
  - compute_profit_factor(closed_trades, fallback=999.0) — gross_profit / gross_loss

قواعد صارمة (Rule 54):
  1. WR لازم يكون 0-100 (percentage)
  2. PF fallback = 999.0 (TradingView convention) لما gross_loss = 0
  3. round WR لـ 1 رقم عشري، PF لـ 2 رقم
  4. HARD cap (Rule 7): actual_return محدود لـ ±50% (عشان تمنع toxic returns)
  5. dedup-by-ticker (Rule 22): لو في تكرار للسهم، ناخد أعلى score

المرجعية:
  - Rule 54 (00-CONSTITUTION.md)
  - Documentation/ENGINEERING_AUDIT_REPORT.md (Bug #6: 30+ inline copies, fallback = 999/0/0.25/infinity)

الاستخدام:
  from utils.backtest_stats import compute_win_rate, compute_profit_factor
  wr = compute_win_rate(closed_trades)
  pf = compute_profit_factor(closed_trades)
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional, Iterable
import math


def _normalize_return(ret: Any, hard_cap: float = 50.0) -> Optional[float]:
    """تحويل actual_return لـ float مع HARD cap (Rule 7)."""
    if ret is None:
        return None
    try:
        r = float(ret)
        if math.isnan(r) or math.isinf(r):
            return None
        # HARD cap (Rule 7): |return| <= 50%
        if abs(r) > hard_cap:
            return None
        return r
    except (TypeError, ValueError):
        return None


def compute_win_rate(closed_trades: Iterable[Dict[str, Any]],
                     dedup_by_ticker: bool = True) -> float:
    """حساب Win Rate — canonical.

    Args:
        closed_trades: iterable من التوقعات المغلقة. كل توقع لازم فيه:
            - 'actual_return' (float) أو 'is_correct' (0/1)
            - 'ticker' (str) — لو dedup_by_ticker=True
        dedup_by_ticker: لو True، نـ dedup بـ ticker (نأخذ أعلى score) — Rule 22

    Returns:
        Win Rate كـ percentage (0-100)، rounded لـ 1 رقم عشري.
        لو مفيش صفقات → بـ يرجّع 0.0.
    """
    if not closed_trades:
        return 0.0

    trades_list = list(closed_trades)
    if not trades_list:
        return 0.0

    # dedup by ticker (Rule 22) — نأخذ أعلى score لكل ticker
    if dedup_by_ticker:
        by_ticker: Dict[str, Dict[str, Any]] = {}
        for t in trades_list:
            ticker = str(t.get('ticker', '')).strip().upper()
            if not ticker:
                continue
            if ticker not in by_ticker:
                by_ticker[ticker] = t
            else:
                # خد الأعلى score
                existing_score = float(by_ticker[ticker].get('master_score', 0) or 0)
                new_score = float(t.get('master_score', 0) or 0)
                if new_score > existing_score:
                    by_ticker[ticker] = t
        trades_list = list(by_ticker.values())

    wins = 0
    total = 0
    for t in trades_list:
        # الأول: actual_return (مع HARD cap — Rule 7)
        # لو الـ return toxic (|return| > 50%) → نتخطاه خالص
        ret = _normalize_return(t.get('actual_return'))
        if ret is None:
            continue
        total += 1

        # ثانياً: is_correct (لو موجود) — لكن بس لو الـ return مش toxic
        is_correct = t.get('is_correct')
        if is_correct is not None:
            try:
                if int(is_correct) == 1:
                    wins += 1
                continue
            except (TypeError, ValueError):
                pass

        # ثالثاً: من الـ return نفسه
        if ret > 0:
            wins += 1

    if total == 0:
        return 0.0
    return round((wins / total) * 100, 1)


def compute_profit_factor(closed_trades: Iterable[Dict[str, Any]],
                          fallback: float = 999.0,
                          dedup_by_ticker: bool = True) -> float:
    """حساب Profit Factor — canonical.

    PF = gross_profit / gross_loss
    - gross_profit = sum(returns > 0)
    - gross_loss = sum(abs(returns < 0))
    - fallback (default 999.0 — TradingView convention) لما gross_loss = 0

    Args:
        closed_trades: iterable من التوقعات المغلقة
        fallback: القيمة لما gross_loss = 0 (default: 999.0)
        dedup_by_ticker: لو True، نـ dedup بـ ticker — Rule 22

    Returns:
        PF rounded لـ 2 رقم عشري، أو fallback.
    """
    if not closed_trades:
        return 0.0

    trades_list = list(closed_trades)
    if not trades_list:
        return 0.0

    # dedup by ticker (Rule 22)
    if dedup_by_ticker:
        by_ticker: Dict[str, Dict[str, Any]] = {}
        for t in trades_list:
            ticker = str(t.get('ticker', '')).strip().upper()
            if not ticker:
                continue
            if ticker not in by_ticker:
                by_ticker[ticker] = t
            else:
                existing_score = float(by_ticker[ticker].get('master_score', 0) or 0)
                new_score = float(t.get('master_score', 0) or 0)
                if new_score > existing_score:
                    by_ticker[ticker] = t
        trades_list = list(by_ticker.values())

    gross_profit = 0.0
    gross_loss = 0.0
    for t in trades_list:
        ret = _normalize_return(t.get('actual_return'))
        if ret is None:
            continue
        if ret > 0:
            gross_profit += ret
        elif ret < 0:
            gross_loss += abs(ret)

    if gross_loss == 0:
        return fallback
    if gross_profit == 0:
        return 0.0
    return round(gross_profit / gross_loss, 2)

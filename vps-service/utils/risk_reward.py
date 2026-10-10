"""
utils/risk_reward.py — Canonical Risk:Reward Calculation
==========================================================
**Rule 54 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب R:R في الـ Python backend.

الصيغة:
  - BUY setup (target > entry, stop < entry):
      risk = entry - stop
      reward = target - entry
      rr = reward / risk
  - SELL setup (target < entry, stop > entry):
      risk = stop - entry
      reward = entry - target
      rr = reward / risk

الـ fallback: لو أي قيمة = 0 أو invalid → بـ يرجّع fallback (default=0.0).

المرجعية:
  - Rule 54 (00-CONSTITUTION.md)
  - Documentation/ENGINEERING_AUDIT_REPORT.md (Bug #4: 11+ Python inline copies)
  - النسخة TS: src/lib/risk-reward.ts::computeRiskReward() (matching)

الاستخدام:
  from utils.risk_reward import compute_risk_reward
  rr = compute_risk_reward(entry=100, target=112, stop=94)
"""
from __future__ import annotations
from typing import Optional


def compute_risk_reward(entry: float, target: float, stop: float,
                        fallback: float = 0.0) -> float:
    """حساب R:R (Risk:Reward) — canonical.

    Args:
        entry: سعر الدخول
        target: سعر الهدف
        stop: سعر الوقف
        fallback: القيمة اللي ترجّع لو الحساب غير صالح (default: 0.0)

    Returns:
        قيمة R:R rounded لـ 2 أرقام، أو fallback لو invalid.

    Notes:
        - يكتشف BUY vs SELL تلقائياً من علاقة target/stop بـ entry
        - لو entry == stop (risk=0) → بـ يرجّع fallback (مش infinity)
        - لو target == entry (reward=0) → بـ يرجّع 0.0
        - لو الـ geometry معكوسة (target < entry AND stop < entry) → fallback
    """
    try:
        if entry is None or target is None or stop is None:
            return fallback
        entry = float(entry)
        target = float(target)
        stop = float(stop)
        if entry <= 0 or stop <= 0 or target <= 0:
            return fallback

        # BUY setup: target > entry > stop
        if target > entry and stop < entry:
            risk = entry - stop
            reward = target - entry
        # SELL setup: stop > entry > target
        elif stop > entry and target < entry:
            risk = stop - entry
            reward = entry - target
        else:
            # geometry معكوسة أو ملخبطة
            return fallback

        if risk <= 0:
            return fallback
        if reward <= 0:
            return 0.0
        return round(reward / risk, 2)
    except (TypeError, ValueError, ZeroDivisionError):
        return fallback


def compute_risk_reward_safe(entry: float, target: float, stop: float) -> Optional[float]:
    """نسخة safe بـ ترجّع None لو invalid (بدل fallback).

    مفيدة لو الـ caller عايز يميّز بين "حساب صالح" و "invalid".
    """
    result = compute_risk_reward(entry, target, stop, fallback=float('nan'))
    if result != result:  # NaN check
        return None
    return result

"""
whale_guard.py — Strangler Pattern module (Phase 7.2)
======================================================
Extracted VERBATIM from `vps-service/jobs/daily_predictor.py` (lines ~52-75).
The original function `_whale_distribution_guard()` is re-exported by
daily_predictor.py so callers see no behavior change.

Purpose:
    Phase 2 #1: فحص تصريف الحيتان — لو صافي التدفق سالب (تصريف) → أمنع BUY.
    يحمي المتداول من مصايد الثبال (bull traps) على أسهم بنزف مؤسسي.
"""
from __future__ import annotations

import sys
from pathlib import Path


def _whale_distribution_guard(opens, highs, lows, closes, volumes):
    """Phase 2 #1: فحص تصريف الحيتان — لو صافي التدفق سالب (تصريف) → أمنع BUY.
    يحمي المتداول من مصايد الثبال (bull traps) على أسهم بنزف مؤسسي."""
    try:
        _root = Path(__file__).resolve().parents[3]
        if str(_root) not in sys.path:
            sys.path.insert(0, str(_root))
        _scripts = _root / "scripts"
        if str(_scripts) not in sys.path:
            sys.path.insert(0, str(_scripts))
        n = min(len(opens), len(highs), len(lows), len(closes), len(volumes))
        if n < 5:
            return False  # بيانات غير كافية للفحص — لا تمنع
        candles = [{'open': opens[i], 'high': highs[i], 'low': lows[i], 'close': closes[i], 'volume': volumes[i]} for i in range(n)]
        try:
            from scripts.liquidity_radar_v2 import compute_whale_flow
        except ImportError:
            from liquidity_radar_v2 import compute_whale_flow
        whale = compute_whale_flow(candles)
        return (whale.get('net_flow_egp', 0) or 0) < 0  # distributing → block BUY
    except Exception as e:
        # لا بلع أخطاء — يُسجّل صراحة + fail-open (لا يمنع BUY لو الفحص فشل).
        sys.stderr.write(f"[daily_predictor] whale_distribution_guard error: {e}\n")
        return False

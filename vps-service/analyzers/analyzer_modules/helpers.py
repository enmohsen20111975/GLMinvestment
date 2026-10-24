"""
helpers.py — دوال مساعدة (Phase 9.1 — Strangler Pattern V2)
============================================================

اتسحب من master_analyzer.py:
  - _parse_volume_float (parsing volumes with K/M/B suffixes)
  - _safe_div (safe division, prevents zero-division crashes)

Author: برافو (Phase 9.1 — Strangler Pattern V2)
"""
from __future__ import annotations

import re
import math


def _parse_volume_float(v):
    """Parse volume string with K/M/B suffixes to float."""
    if not v:
        return 0.0
    try:
        return float(v)
    except (ValueError, TypeError):
        pass
    try:
        s = str(v).replace('\u202f', '').replace(' ', '').replace(',', '').upper()
        mult = 1.0
        for suffix, m in (('K', 1e3), ('M', 1e6), ('B', 1e9)):
            if suffix in s:
                mult = m
                s = s.replace(suffix, '')
                break
        clean_num = re.sub(r'[^\d.]', '', s)
        return float(clean_num) * mult if clean_num else 0.0
    except Exception:
        return 0.0


def _safe_div(a, b, default=1.0):
    """P7-VOLUME-FIX: Safe division — prevents float division by zero.

    Returns:
        a / b if b > 0 and valid, else default (1.0).
    """
    try:
        _a = float(a) if a is not None else 0.0
        _b = float(b) if b is not None else 0.0
    except (ValueError, TypeError):
        return default
    if _b == 0 or not math.isfinite(_b) or not math.isfinite(_a):
        return default
    return _a / _b

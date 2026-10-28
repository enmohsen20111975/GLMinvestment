"""
safe_converters.py — Canonical safe conversion utilities (Batch E)
=================================================================
Single source of truth for _safe_float, _to_float, parse_volume.

Before: 20+ files had their own _safe_float (5 different implementations)
        23+ files had their own parse_volume
        10+ files had their own _to_float

Now: import from here:
    from utils.safe_converters import safe_float, to_float, parse_volume

Behavior preserved:
- safe_float: handles None, NaN, Inf, Unicode minus, Arabic comma, K/M/B suffixes
- to_float: simpler version (no K/M/B) for pure numeric strings
- parse_volume: handles K/M/B suffixes + None + garbage → 0.0

NOTE: This module does NOT force existing files to migrate.
      It provides the canonical version for new code and gradual migration.
"""
from __future__ import annotations

import math
import re
from typing import Optional


def safe_float(val, default: float = 0.0) -> float:
    """تحويل آمن لـ float — يتعامل مع كل الحالات.

    Handles:
    - None → default
    - NaN / Infinity → default
    - Unicode minus (−) → ASCII minus
    - Arabic comma (،) → removed
    - Unicode spaces (\u202f, \xa0) → removed
    - K/M/B suffixes (e.g. "219.87K" → 219870.0)
    - Plain numbers → float

    Args:
        val: any value (str, int, float, None)
        default: return value if conversion fails (default: 0.0)

    Returns:
        float value, or default if conversion fails
    """
    if val is None:
        return default
    if isinstance(val, (int, float)):
        if not math.isfinite(val):
            return default
        return float(val)
    try:
        s = str(val).replace('−', '-').replace('،', '').replace('\u202f', '').replace('\xa0', '').strip()
        # Handle K/M/B suffixes
        m = re.match(r'^([+-]?\d+\.?\d*)\s*([KMBkmb])?$', s)
        if m:
            num = float(m.group(1))
            suffix = (m.group(2) or '').upper()
            if suffix == 'K':
                num *= 1_000
            elif suffix == 'M':
                num *= 1_000_000
            elif suffix == 'B':
                num *= 1_000_000_000
            return num if math.isfinite(num) else default
        # Fallback: try direct float conversion
        return float(s) if s else default
    except (ValueError, TypeError):
        return default


def to_float(val, default: float = 0.0) -> float:
    """تحويل أبسط لـ float — بدون K/M/B suffixes.

    Use this when the input is expected to be a plain number
    (not a volume string with suffixes).
    """
    if val is None:
        return default
    try:
        v = float(val)
        return v if math.isfinite(v) else default
    except (ValueError, TypeError):
        return default


def parse_volume(val) -> float:
    """Parse volume string with K/M/B suffixes to float.

    Handles:
    - None → 0.0
    - "1.5K" → 1500.0
    - "2M" → 2000000.0
    - "3B" → 3000000000.0
    - "1000" → 1000.0
    - "" → 0.0
    - "abc" → 0.0
    - Unicode spaces + Arabic comma → cleaned
    """
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val) if math.isfinite(val) else 0.0
    s = str(val).strip().upper().replace('\u202f', '').replace('\xa0', '').replace(' ', '')
    if not s:
        return 0.0
    multipliers = {'K': 1_000, 'M': 1_000_000, 'B': 1_000_000_000}
    for suffix, multiplier in multipliers.items():
        if s.endswith(suffix):
            try:
                return float(s[:-1]) * multiplier
            except ValueError:
                return 0.0
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0


__all__ = ['safe_float', 'to_float', 'parse_volume']

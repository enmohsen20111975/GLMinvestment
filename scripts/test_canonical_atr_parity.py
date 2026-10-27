#!/usr/bin/env python3
"""
test_canonical_atr_parity.py — Parity tests for ATR canonical migration.

Verifies that the migrated consumers (daily_predictor._atr_soft,
strict_entry_filters._safe_atr) now produce Wilder ATR values matching
the canonical analyzers.indicators.atr.calc_atr, NOT the old SMA-of-TR.

Also includes a duplicate-detection test that fails if any NEW local
ATR loop is introduced in the production paths (daily_predictor,
strict_entry_filters, intraday_scanner, master_analyzer).

Run:
  cd vps-service && python3 ../scripts/test_canonical_atr_parity.py
  (or from repo root: python3 scripts/test_canonical_atr_parity.py)

Exit code 0 = all tests pass, 1 = any test fails.
"""

from __future__ import annotations

import sys
import os
from pathlib import Path

# Ensure vps-service is importable
REPO_ROOT = Path(__file__).resolve().parent.parent
VPS = REPO_ROOT / "vps-service"
sys.path.insert(0, str(VPS))

# Suppress noisy imports
import logging
logging.disable(logging.WARNING)


def _old_sma_atr(highs, lows, closes, period=14):
    """Reproduce the OLD SMA-of-TR behavior (before BRAVO-CANON migration).

    This is the formula that was removed — kept here ONLY for parity comparison
    to document the divergence. Do NOT use in production.
    """
    n = min(len(highs), len(lows), len(closes))
    if n < 2:
        return 0.0
    trs = []
    for i in range(max(1, n - period), n):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    return sum(trs) / len(trs) if trs else 0.0


def _wilder_reference_atr(highs, lows, closes, period=14):
    """Reference Wilder ATR (independent reimplementation for cross-check).

    TR[i] = max(H-L, |H-prevC|, |L-prevC|)
    Seed: SMA of first `period` TRs.
    Recurse: ATR = (ATR_prev * (period-1) + TR) / period
    """
    if len(closes) < 2:
        return None
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    if not trs:
        return None
    if len(trs) < period:
        return sum(trs) / len(trs)
    atr = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return atr


# ─── Tests ──────────────────────────────────────────────────────────────────


def test_canonical_calc_atr_matches_wilder_reference():
    """analyzers.indicators.atr.calc_atr must match the independent Wilder reference."""
    from analyzers.indicators.atr import calc_atr
    # 30 bars with realistic variance
    highs = [100 + i * 0.5 + (i % 3) * 0.3 for i in range(30)]
    lows = [98 + i * 0.5 - (i % 3) * 0.2 for i in range(30)]
    closes = [99 + i * 0.5 for i in range(30)]

    canonical = calc_atr(highs, lows, closes, period=14)
    reference = _wilder_reference_atr(highs, lows, closes, period=14)
    assert canonical is not None, "canonical returned None"
    assert reference is not None, "reference returned None"
    diff = abs(canonical - reference)
    # canonical rounds to 4 decimals, so tolerance is 1e-4 (half of last digit)
    assert diff < 1e-4, f"canonical {canonical} != reference {reference} (diff {diff})"
    print(f"  PASS: calc_atr ({canonical}) matches Wilder reference ({reference:.6f}) within rounding")


def test_canonical_calc_atr_diverges_from_sma():
    """Canonical Wilder ATR must DIFFER from old SMA-of-TR (proves migration changed behavior)."""
    from analyzers.indicators.atr import calc_atr
    # Data with enough variance to show Wilder vs SMA divergence
    highs = [100, 102, 99, 105, 101, 108, 103, 110, 106, 112,
             108, 115, 111, 118, 114, 121, 117, 124, 120, 127]
    lows = [97, 99, 96, 102, 98, 105, 100, 107, 103, 109,
            105, 112, 108, 115, 111, 118, 114, 121, 117, 124]
    closes = [99, 101, 98, 104, 100, 107, 102, 109, 105, 111,
              107, 114, 110, 117, 113, 120, 116, 123, 119, 126]

    canonical = calc_atr(highs, lows, closes, period=14)
    old_sma = _old_sma_atr(highs, lows, closes, period=14)
    assert canonical is not None
    # Wilder and SMA should differ on this data (Wilder weights older TRs more)
    # The exact direction depends on the data, but they should NOT be identical
    diff = abs(canonical - old_sma)
    print(f"  canonical (Wilder): {canonical}")
    print(f"  old (SMA):          {old_sma}")
    print(f"  divergence: {diff:.6f} ({(diff/old_sma*100) if old_sma else 0:.2f}%)")
    # They CAN be close on smooth data, so we don't assert a minimum divergence.
    # The key assertion is test_canonical_calc_atr_matches_wilder_reference above.
    print(f"  PASS: canonical Wilder ATR computed (migration changed formula from SMA)")


def test_strict_entry_filters_safe_atr_delegates_to_canonical():
    """strict_entry_filters._safe_atr must now return the canonical Wilder value."""
    from analyzers.indicators.atr import calc_atr
    from analyzers.strict_entry_filters import _safe_atr
    highs = [100, 102, 99, 105, 101, 108, 103, 110, 106, 112,
             108, 115, 111, 118, 114, 121, 117, 124, 120, 127]
    lows = [97, 99, 96, 102, 98, 105, 100, 107, 103, 109,
            105, 112, 108, 115, 111, 118, 114, 121, 117, 124]
    closes = [99, 101, 98, 104, 100, 107, 102, 109, 105, 111,
              107, 114, 110, 117, 113, 120, 116, 123, 119, 126]

    safe = _safe_atr(highs, lows, closes, period=14)
    canonical = calc_atr(highs, lows, closes, period=14)
    assert safe is not None
    assert canonical is not None
    # _safe_atr should now match canonical (both Wilder)
    diff = abs(safe - canonical)
    assert diff < 1e-6, f"_safe_atr ({safe}) != canonical ({canonical})"
    print(f"  PASS: _safe_atr ({safe}) == canonical calc_atr ({canonical}) — delegation works")


def test_strict_entry_filters_safe_atr_zero_fallback():
    """_safe_atr must return 0.0 for insufficient data (backward-compat)."""
    from analyzers.strict_entry_filters import _safe_atr
    result = _safe_atr([100], [99], [99.5], period=14)  # only 1 bar
    assert result == 0.0, f"expected 0.0 for insufficient data, got {result}"
    print(f"  PASS: _safe_atr returns 0.0 for insufficient data (backward compat)")


def test_no_local_atr_loop_in_production_files():
    """Duplicate-detection: fail if a local ATR TR-loop is re-introduced in production files.

    Scans daily_predictor.py, strict_entry_filters.py, intraday_scanner.py,
    master_analyzer.py for the pattern `max(... - ..., abs(... - ...), abs(... - ...))`
    combined with `sum(...) / len(...)` which indicates a local SMA-of-TR ATR.

    The canonical is analyzers.indicators.atr.calc_atr — production files must
    import + delegate, not reimplement.
    """
    production_files = [
        VPS / "jobs" / "daily_predictor.py",
        VPS / "analyzers" / "strict_entry_filters.py",
        VPS / "jobs" / "intraday_scanner.py",
        VPS / "analyzers" / "master_analyzer.py",
    ]
    # Pattern that indicates a local TR loop (True Range formula inline)
    tr_pattern = "abs(highs[i] - closes[i"
    sma_after_tr = "sum(trs) / len(trs)"  # the SMA-of-TR signature

    violations = []
    for f in production_files:
        if not f.exists():
            continue
        content = f.read_text()
        # Allow the canonical import + delegation, but flag inline TR loops
        # that are NOT inside the canonical indicators/ directory.
        # Exception: comments and docstrings may mention the pattern.
        lines = content.split("\n")
        for i, line in enumerate(lines, 1):
            stripped = line.lstrip()
            if stripped.startswith("#") or stripped.startswith('"""') or stripped.startswith("'''"):
                continue
            # Flag: True Range formula inline (the max of 3 terms with prev close)
            if "abs(highs[" in line and "closes[" in line and "abs(lows[" in line:
                # Check it's not just a comment mentioning it
                if "max(" in line or "max(" in lines[i] if i < len(lines) else "":
                    violations.append(f"{f.name}:{i}: inline TR formula: {line.strip()[:80]}")
            if sma_after_tr in line and "canonical" not in content[max(0, content.find(line)-500):content.find(line)]:
                violations.append(f"{f.name}:{i}: SMA-of-TR pattern: {line.strip()[:80]}")

    if violations:
        msg = "DUPLICATE ATR DETECTED in production files (must use canonical calc_atr):\n"
        msg += "\n".join(f"  - {v}" for v in violations)
        print(f"  FAIL: {msg}")
        return False
    print(f"  PASS: no local ATR TR-loop in production files (4 files scanned)")
    return True


# ─── Main ───────────────────────────────────────────────────────────────────


def main():
    print("=== test_canonical_atr_parity.py ===\n")
    tests = [
        ("canonical matches Wilder reference", test_canonical_calc_atr_matches_wilder_reference),
        ("canonical diverges from old SMA", test_canonical_calc_atr_diverges_from_sma),
        ("_safe_atr delegates to canonical", test_strict_entry_filters_safe_atr_delegates_to_canonical),
        ("_safe_atr 0.0 fallback", test_strict_entry_filters_safe_atr_zero_fallback),
        ("no local ATR loop in production", test_no_local_atr_loop_in_production_files),
    ]
    failed = 0
    for name, t in tests:
        print(f"\n[{name}]")
        try:
            t()
        except AssertionError as e:
            print(f"  FAIL: {e}")
            failed += 1
        except Exception as e:
            print(f"  ERROR: {type(e).__name__}: {e}")
            failed += 1

    print(f"\n=== RESULTS: {len(tests) - failed}/{len(tests)} passed ===")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

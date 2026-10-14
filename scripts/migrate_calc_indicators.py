#!/usr/bin/env python3
"""
migrate_calc_indicators.py — Canonical indicators migration tracker
====================================================================
P1-CRIT FIX (2026-10-14): Track migration of duplicate calc_atr/calc_rsi
definitions to the canonical location: analyzers/indicators/{atr.py,rsi.py}

This is a READ-ONLY audit script — it does NOT modify any files.
It reports the current state of duplication and which files have already
migrated to import from the canonical location.

Rule 67b (CALCULATION-CANONICAL): one canonical definition per indicator.
  - Canonical ATR: analyzers/indicators/atr.py (Wilder's smoothing)
  - Canonical RSI: analyzers/indicators/rsi.py

Usage:
    python3 scripts/migrate_calc_indicators.py
"""

import os
import re
import sys
from pathlib import Path
from typing import List, Dict, Tuple

# Project root (parent of scripts/)
ROOT = Path(__file__).resolve().parents[1]
VPS = ROOT / "vps-service"

# Canonical location
CANONICAL_ATR = "vps-service/analyzers/indicators/atr.py"
CANONICAL_RSI = "vps-service/analyzers/indicators/rsi.py"

# Files known to have duplicate calc_atr / calculate_atr definitions
# (from AUDIT_REPORT_FULL.md Section 1.2 — Rule 67b violation)
DUPLICATE_ATR_FILES = [
    "vps-service/engines/backtest_engine.py",
    "vps-service/scripts/honest_backtest_egx.py",
    "vps-service/scripts/backtest_sniper.py",
    "vps-service/scripts/honest_backtest_regime.py",
    "vps-service/scripts/honest_backtest_trend.py",
    "vps-service/analyzers/sniper_engine.py",
    "vps-service/analyzers/enhanced_indicators.py",
    "vps-service/analyzers/core_scoring_engine.py",
    "vps-service/analyzers/dynamic_target_engine.py",
]

DUPLICATE_RSI_FILES = [
    "vps-service/scripts/honest_backtest_egx.py",
    "vps-service/scripts/backtest_sniper.py",
    "vps-service/scripts/honest_backtest_regime.py",
    "vps-service/scripts/honest_backtest_trend.py",
    "vps-service/analyzers/sniper_engine.py",
]


def find_duplicate_definitions(pattern: str, search_paths: List[str]) -> List[Tuple[str, int, str]]:
    """Find all lines matching a def pattern in the given files."""
    results = []
    for rel_path in search_paths:
        abs_path = ROOT / rel_path
        if not abs_path.exists():
            results.append((rel_path, 0, "FILE NOT FOUND"))
            continue
        try:
            with open(abs_path, 'r', encoding='utf-8') as f:
                for line_num, line in enumerate(f, 1):
                    if re.search(pattern, line):
                        results.append((rel_path, line_num, line.strip()))
        except Exception as e:
            results.append((rel_path, 0, f"ERROR: {e}"))
    return results


def check_canonical_import(file_path: str) -> Dict[str, bool]:
    """Check if a file imports from the canonical indicators module."""
    abs_path = ROOT / file_path
    if not abs_path.exists():
        return {"atr": False, "rsi": False, "exists": False}

    try:
        content = abs_path.read_text(encoding='utf-8')
        return {
            "atr": bool(re.search(r"from\s+analyzers\.indicators(?:\.atr)?\s+import\s+calc_atr", content)
                     or re.search(r"from\s+\.indicators\s+import\s+calc_atr", content)
                     or re.search(r"from\s+\.\.analyzers\.indicators\s+import\s+calc_atr", content)),
            "rsi": bool(re.search(r"from\s+analyzers\.indicators(?:\.rsi)?\s+import\s+calc_rsi", content)
                     or re.search(r"from\s+\.indicators\s+import\s+calc_rsi", content)
                     or re.search(r"from\s+\.\.analyzers\.indicators\s+import\s+calc_rsi", content)),
            "exists": True,
        }
    except Exception:
        return {"atr": False, "rsi": False, "exists": False}


def main() -> int:
    print("=" * 72)
    print("P1-CRIT FIX (2026-10-14): calc_atr / calc_rsi Migration Audit")
    print("Rule 67b (CALCULATION-CANONICAL) — one canonical definition per indicator")
    print("=" * 72)

    # Verify canonical files exist
    canonical_atr_path = ROOT / CANONICAL_ATR
    canonical_rsi_path = ROOT / CANONICAL_RSI
    print(f"\nCanonical ATR: {CANONICAL_ATR} — {'✓ exists' if canonical_atr_path.exists() else '✗ MISSING'}")
    print(f"Canonical RSI: {CANONICAL_RSI} — {'✓ exists' if canonical_rsi_path.exists() else '✗ MISSING'}")

    # Find duplicates
    print("\n" + "-" * 72)
    print("ATR Duplicates (def calc_atr or def calculate_atr):")
    print("-" * 72)
    atr_dups = find_duplicate_definitions(r"def\s+(calc_atr|calculate_atr)\s*\(", DUPLICATE_ATR_FILES)
    for rel_path, line_num, line in atr_dups:
        if line_num == 0:
            print(f"  {rel_path}: {line}")
        else:
            imports = check_canonical_import(rel_path)
            status = "✓ imports canonical" if imports.get("atr") else "✗ uses local duplicate"
            print(f"  {rel_path}:{line_num}")
            print(f"    → {line[:80]}")
            print(f"    → {status}")

    print("\n" + "-" * 72)
    print("RSI Duplicates (def calc_rsi or def calculate_rsi):")
    print("-" * 72)
    rsi_dups = find_duplicate_definitions(r"def\s+(calc_rsi|calculate_rsi)\s*\(", DUPLICATE_RSI_FILES)
    for rel_path, line_num, line in rsi_dups:
        if line_num == 0:
            print(f"  {rel_path}: {line}")
        else:
            imports = check_canonical_import(rel_path)
            status = "✓ imports canonical" if imports.get("rsi") else "✗ uses local duplicate"
            print(f"  {rel_path}:{line_num}")
            print(f"    → {line[:80]}")
            print(f"    → {status}")

    # Summary
    total_atr = sum(1 for _, n, _ in atr_dups if n > 0)
    total_rsi = sum(1 for _, n, _ in rsi_dups if n > 0)
    atr_migrated = sum(1 for f, n, _ in atr_dups if n > 0 and check_canonical_import(f).get("atr"))
    rsi_migrated = sum(1 for f, n, _ in rsi_dups if n > 0 and check_canonical_import(f).get("rsi"))

    print("\n" + "=" * 72)
    print("SUMMARY")
    print("=" * 72)
    print(f"ATR: {atr_migrated}/{total_atr} files already import canonical (Wilder's smoothing)")
    print(f"RSI: {rsi_migrated}/{total_rsi} files already import canonical")
    print(f"\nNext step: Remove local duplicate definitions from the remaining files.")
    print(f"Rule 67b compliance: {'✓ FULL' if atr_migrated == total_atr and rsi_migrated == total_rsi else '⚠ PARTIAL'}")

    return 0 if atr_migrated == total_atr and rsi_migrated == total_rsi else 1


if __name__ == "__main__":
    sys.exit(main())

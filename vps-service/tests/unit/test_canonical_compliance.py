"""
Regression test — Rule 67 (CALCULATION-CANONICAL) compliance.

يمنع ظهور inline implementations جديدة لـ RSI/ATR/Bollinger/MFI/ADX/VWAP/Volume Profile
خارج analyzers/indicators/. كل حساب فني لازم يـ import من canonical library.

الـ test بيـ grep على كل ملفات vps-service/ (ما عدا analyzers/indicators/ نفسها
و tests/) وبيـ check إن مفيش `def calc_rsi` / `def calc_atr` / ... definitions جديدة.

الاستثناءات المسموحة (backward-compat wrappers):
- لو الـ function بـ import canonical وبتـ delegate ليها → OK.
- لو الـ function اسمها `rsi_signal` (مش calculation) → OK.

Usage (pytest-compatible):
    python3 -m pytest tests/unit/test_canonical_compliance.py -v
    # أو كـ script:
    python3 tests/unit/test_canonical_compliance.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # vps-service/
INDICATORS_DIR = ROOT / "analyzers" / "indicators"

# Patterns للكشف عن inline calculation functions
INLINE_PATTERNS = [
    (r"^\s*def\s+calc_rsi\s*\(", "RSI"),
    (r"^\s*def\s+calc_atr\s*\(", "ATR"),
    (r"^\s*def\s+calc_bollinger\s*\(", "Bollinger"),
    (r"^\s*def\s+calc_bollinger_bands\s*\(", "Bollinger Bands"),
    (r"^\s*def\s+calc_bollinger_series\s*\(", "Bollinger Series"),
    (r"^\s*def\s+calc_mfi\s*\(", "MFI"),
    (r"^\s*def\s+calc_adx\s*\(", "ADX"),
    (r"^\s*def\s+calc_vwap\s*\(", "VWAP"),
    (r"^\s*def\s+calc_vwap_premium\s*\(", "VWAP Premium"),
    (r"^\s*def\s+calc_volume_profile\s*\(", "Volume Profile"),
]

# الملفات المسموح لها بـ inline (canonical source فقط)
# BRAVO FIX: شيلت backtest_engine.py — الـ series versions بـ delegate لـ canonical
# والـ test بيـ skipهم تلقائياً (لأنهم بـ mention "canonical" في الـ body)
ALLOWED_INLINE_FILES = {
    # analyzers/indicators/ نفسها (canonical source)
    "analyzers/indicators/rsi.py",
    "analyzers/indicators/atr.py",
    "analyzers/indicators/bollinger.py",
    "analyzers/indicators/mfi.py",
    "analyzers/indicators/adx.py",
    "analyzers/indicators/vwap.py",
    "analyzers/indicators/volume_profile.py",
    "analyzers/indicators/ma.py",
    "analyzers/indicators/srsi.py",
}


def check_no_new_inline() -> list:
    """ارجع list بالـ inline violations الجديدة (مفروض تكون فاضية)."""
    violations = []
    py_files = list(ROOT.rglob("*.py"))

    for fpath in py_files:
        if "__pycache__" in fpath.parts:
            continue
        if "/tests/" in str(fpath) or "\\tests\\" in str(fpath):
            continue

        rel = fpath.relative_to(ROOT).as_posix()

        # skip canonical source
        if rel.startswith("analyzers/indicators/"):
            continue

        # skip allowed files
        if rel in ALLOWED_INLINE_FILES:
            continue

        try:
            src = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        for pattern, name in INLINE_PATTERNS:
            for match in re.finditer(pattern, src, re.MULTILINE):
                line_num = src[:match.start()].count("\n") + 1
                # check لو الـ function بـ delegate لـ canonical (backward-compat wrapper)
                # نـ check الـ 5 سطور اللي بعد الـ def
                lines = src.split("\n")
                func_body = "\n".join(lines[line_num:line_num + 8]) if line_num < len(lines) else ""
                if "canonical" in func_body.lower() or "from analyzers.indicators" in func_body:
                    continue  # delegation — OK
                violations.append({
                    "file": rel,
                    "line": line_num,
                    "indicator": name,
                    "snippet": lines[line_num - 1].strip() if line_num - 1 < len(lines) else "",
                })

    return violations


def main():
    """Script-mode entry — للاستخدام بدون pytest."""
    print("=" * 70)
    print("Rule 67 — CALCULATION-CANONICAL compliance test")
    print("=" * 70)
    print(f"Scanning: {ROOT}")
    print(f"Canonical source: {INDICATORS_DIR}")
    print()

    violations = check_no_new_inline()

    if not violations:
        print("✅ PASS — No new inline indicator calculations outside analyzers/indicators/")
        print("   (existing inline implementations are being migrated gradually)")
        return 0

    print(f"❌ FAIL — Found {len(violations)} inline indicator calculation(s) outside canonical:")
    for v in violations[:20]:
        print(f"   {v['file']}:{v['line']} — {v['indicator']}: {v['snippet']}")
    if len(violations) > 20:
        print(f"   ... and {len(violations) - 20} more")
    return 1


# ============================================================================
# pytest-compatible test functions
# ============================================================================

def test_no_new_inline_indicator_calculations():
    """pytest test — يفشل لو فيه inline violations جديدة خارج canonical."""
    violations = check_no_new_inline()
    assert not violations, (
        f"Found {len(violations)} inline indicator calculation(s) outside "
        f"analyzers/indicators/ (Rule 67 violation):\n"
        + "\n".join(
            f"  {v['file']}:{v['line']} — {v['indicator']}: {v['snippet']}"
            for v in violations[:10]
        )
        + (f"\n  ... and {len(violations) - 10} more" if len(violations) > 10 else "")
    )


def test_canonical_indicators_module_importable():
    """pytest test — يتأكد إن analyzers/indicators/ package بيـ import بنجاح."""
    import sys
    sys.path.insert(0, str(ROOT))
    from analyzers.indicators import (
        calc_rsi, calc_atr, calc_srsi, sma, ema, macd,
        calc_bollinger, calc_bollinger_series,
        calc_mfi, calc_adx, calc_vwap, calc_vwap_premium, calc_volume_profile,
    )
    # كلهم لازم يكونوا callable
    for func in [calc_rsi, calc_atr, calc_srsi, sma, ema, macd,
                 calc_bollinger, calc_bollinger_series,
                 calc_mfi, calc_adx, calc_vwap, calc_vwap_premium, calc_volume_profile]:
        assert callable(func), f"{func} is not callable"


# ============================================================================
# BRAVO FIX (Jimmy issue #5): fabrication pattern detection
# ============================================================================
# Pattern للكشف عن fabrication في indicator/risk functions
# (return 0.0 / 50.0 / -50.0 / 25.0 كـ fallback بدل None)
FABRICATION_PATTERNS = [
    # ATR/Risk fabrication (خطير: ATR=0 → position sizing ضخم)
    (r"^\s*def\s+calc_atr\s*\([^)]*\)[^:]*:\s*$", r"return\s+0\.0\b", "ATR fabrication (return 0.0)"),
    (r"^\s*def\s+calc_bollinger\s*\([^)]*\)[^:]*:\s*$", r"return\s+0\.0,\s*0\.0,\s*0\.0", "Bollinger fabrication"),
    (r"^\s*def\s+calc_bollinger_bands\s*\([^)]*\)[^:]*:\s*$", r"return\s+0\.0,\s*0\.0,\s*0\.0", "Bollinger Bands fabrication"),
    # Generic fabrication patterns في indicator functions
    (r"^\s*def\s+calc_\w+\s*\([^)]*\)[^:]*:\s*$", r"return\s+50\.0\s*$", "calc_* fabrication (return 50.0)"),
    (r"^\s*def\s+calc_\w+\s*\([^)]*\)[^:]*:\s*$", r"return\s+0\.0,\s*0\.0,\s*0\.0", "calc_* fabrication (return 0,0,0)"),
]


def check_fabrication_patterns() -> list:
    """ارجع list بالـ fabrication violations في indicator functions."""
    import ast
    violations = []
    py_files = list(ROOT.rglob("*.py"))

    for fpath in py_files:
        if "__pycache__" in fpath.parts:
            continue
        if "/tests/" in str(fpath) or "\\tests\\" in str(fpath):
            continue

        rel = fpath.relative_to(ROOT).as_posix()
        # skip canonical source + tests
        if rel.startswith("analyzers/indicators/"):
            continue
        if rel in ALLOWED_INLINE_FILES:
            continue

        try:
            src = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        lines = src.split("\n")
        # ابحث عن كل def calc_* functions
        for i, line in enumerate(lines):
            if re.match(r"^\s*def\s+calc_\w+\s*\(", line):
                # ابحث في الـ 15 سطر اللي بعد الـ def عن fabrication patterns
                func_body = "\n".join(lines[i:i+20])
                # skip لو الـ function بـ delegate لـ canonical
                if "canonical" in func_body.lower() or "from analyzers.indicators" in func_body:
                    continue
                # check fabrication patterns
                for _, fab_pattern, fab_name in FABRICATION_PATTERNS:
                    if re.search(fab_pattern, func_body, re.MULTILINE):
                        # لازم نتأكد إن الـ fabrication في الـ fallback (مش في الـ normal path)
                        # بـ check إن فيه `if` قبل الـ return
                        for j in range(i, min(i+20, len(lines))):
                            if re.search(fab_pattern, lines[j]):
                                # check لو فيه if قبلها
                                prev_lines = "\n".join(lines[i:j])
                                if "if " in prev_lines or "else:" in prev_lines:
                                    violations.append({
                                        "file": rel,
                                        "line": j + 1,
                                        "function": line.strip(),
                                        "fabrication": fab_name,
                                        "snippet": lines[j].strip(),
                                    })
                                    break
    return violations


def test_no_fabrication_patterns_in_calc_functions():
    """pytest test — يفشل لو فيه fabrication patterns في calc_* functions خارج canonical.
    Rule 27 (NO-FAKE-DATA): fallbacks لازم return None، مش fabricated values.
    """
    violations = check_fabrication_patterns()
    # حالياً نـ allow الـ scoring defaults (return 50.0 neutral) — بس نـ flag الـ 0.0 fabrication
    critical_violations = [v for v in violations if "0.0" in v['fabrication']]
    assert not critical_violations, (
        f"Found {len(critical_violations)} critical fabrication pattern(s) "
        f"(return 0.0 in calc_* fallbacks — Rule 27 violation):\n"
        + "\n".join(
            f"  {v['file']}:{v['line']} — {v['fabrication']}: {v['snippet']}"
            for v in critical_violations[:10]
        )
    )


if __name__ == "__main__":
    sys.exit(main())

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


if __name__ == "__main__":
    sys.exit(main())

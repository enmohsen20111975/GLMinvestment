"""
analyzer_modules — تفكيك master_analyzer.py (Phase 9.1 — Strangler Pattern V2)
=============================================================================

الـ package ده بيحوي الـ functions اللي اتسحبت من `master_analyzer.py` (5,786 LOC)
عشان يبقى كل ملف صغير (< 300 LOC) وقابل للصيانة.

Modules:
  - screener_helpers.py — screener stale check + auto-fetch + get_screener_tags
  - fibonacci.py        — _calc_fibonacci_levels
  - candlestick.py      — _detect_candlestick_patterns

Rule 77 (GARAGE-NOT-DELETE): الكود القديم مش بيمسح — بيتنقل لـ modules.
Rule 78 (DOCUMENT-AS-YOU-GO): كل module موثق.

Author: برافو (Phase 9.1 — Modularization V2)
"""

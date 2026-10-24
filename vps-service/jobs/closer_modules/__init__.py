"""
closer_modules — تفكيك daily_closer.py (Phase 9.1 — Strangler Pattern V2)
=========================================================================

الـ package ده بيحوي الـ functions اللي اتسحبت من `daily_closer.py` (3,501 LOC)
عشان يبقى كل ملف صغير (< 300 LOC) وقابل للصيانة.

Modules:
  - atr_helpers.py — _compute_atr_at_entry (ATR calculation at entry time)
  - price_helpers.py — get_price_history + _get_current_price_stocks

Author: برافو (Phase 9.1 — Strangler Pattern V2)
"""

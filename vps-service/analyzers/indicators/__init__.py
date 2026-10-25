"""
analyzers/indicators/__init__.py — Canonical Technical Indicators
=================================================================
المرجع الموحّد لكل المؤشرات الفنية في المشروع (Rule 67 — CALCULATION-CANONICAL).

كل حساب فني لازم يندى من هنا — ممنوع inline copies.

الـ canonical functions:
  - calc_atr()              — Wilder's smoothing
  - calc_rsi()              — Wilder's smoothing
  - calc_srsi()             — Stochastic RSI (Chande & Kroll 1994) — مكمّل لـ RSI
  - calc_bollinger()        — Bollinger Bands (آخر قيمة)
  - calc_bollinger_series() — Bollinger Bands (series كاملة للرسوم)
  - calc_mfi()              — Money Flow Index (volume-weighted RSI)
  - calc_adx()              — ADX/DMI (Wilder's) — قوة الترند
  - calc_vwap()             — VWAP (session أو rolling)
  - calc_vwap_premium()     — VWAP premium %
  - calc_volume_profile()   — Volume Profile (POC/VAH/VAL)
  - sma()                   — Simple Moving Average
  - ema()                   — Exponential Moving Average (recursive)
  - macd()                  — MACD (12, 26, 9)

ملاحظة عن RSI vs SRSI:
  - RSI = industry standard عالمي (Wilder 1978) — مش قديم، هو الأساس
  - SRSI = أكثر حساسية، مكمّل لـ RSI (مش بديل)
  - المحترفين بيستخدموا الاتنين:
    * RSI لتحديد الترند (أساسي)
    * SRSI لتوقيت الدخول/الخروج (تأكيد ثانوي)

المرجعية:
  - Rule 67 (00-CONSTITUTION.md)
  - Documentation/ENGINEERING_AUDIT_REPORT.md
  - Documentation/EMERGENCY_REMEDIATION_PLAN.md (Phase 2)
"""
from .atr import calc_atr
from .rsi import calc_rsi
from .srsi import calc_srsi
from .bollinger import calc_bollinger, calc_bollinger_series
from .mfi import calc_mfi
from .adx import calc_adx
from .vwap import calc_vwap, calc_vwap_premium
from .volume_profile import calc_volume_profile
from .ma import sma, ema, macd

__all__ = [
    # Wilder's indicators
    'calc_atr', 'calc_rsi', 'calc_srsi', 'calc_adx',
    # Bollinger
    'calc_bollinger', 'calc_bollinger_series',
    # Volume-weighted
    'calc_mfi', 'calc_vwap', 'calc_vwap_premium', 'calc_volume_profile',
    # Moving averages
    'sma', 'ema', 'macd',
]

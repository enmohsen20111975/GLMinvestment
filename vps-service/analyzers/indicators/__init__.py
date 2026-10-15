"""
analyzers/indicators/__init__.py — Canonical Technical Indicators
=================================================================
المرجع الموحّد لكل المؤشرات الفنية في المشروع (Rule 54 — CALCULATION-CANONICAL).

كل حساب فني لازم يندى من هنا — ممنوع inline copies.

الـ canonical functions:
  - calc_atr()   — Wilder's smoothing
  - calc_rsi()   — Wilder's smoothing
  - calc_srsi()  — Stochastic RSI (Chande & Kroll 1994) — مكمّل لـ RSI
  - sma()        — Simple Moving Average
  - ema()        — Exponential Moving Average (recursive)
  - macd()       — MACD (12, 26, 9)

ملاحظة عن RSI vs SRSI:
  - RSI = industry standard عالمي (Wilder 1978) — مش قديم، هو الأساس
  - SRSI = أكثر حساسية، مكمّل لـ RSI (مش بديل)
  - المحترفين بيستخدموا الاتنين:
    * RSI لتحديد الترند (أساسي)
    * SRSI لتوقيت الدخول/الخروج (تأكيد ثانوي)

المرجعية:
  - Rule 54 (00-CONSTITUTION.md)
  - Documentation/ENGINEERING_AUDIT_REPORT.md
  - Documentation/EMERGENCY_REMEDIATION_PLAN.md (Phase 2)
"""
from .atr import calc_atr
from .rsi import calc_rsi
from .srsi import calc_srsi
from .ma import sma, ema, macd, bollinger

__all__ = ['calc_atr', 'calc_rsi', 'calc_srsi', 'sma', 'ema', 'macd', 'bollinger']


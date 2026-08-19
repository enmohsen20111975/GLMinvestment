"""
GLMinvestment — Expert Engines Package
======================================
ترجمة خوارزمية لأساطير التداول إلى كود قابل للتنفيذ.

Modules:
    core.indicators   — ATR, SMA, EMA, Donchian, RSI, ADX (Wilder-style)
    core.base         — أنواع البيانات الموحدة (Signal, Position, RiskPlan)

    engines.atr_risk_engine       — #1 إدارة المخاطر بالـ ATR (Covel/Wilder)
    engines.stage2_filter         — #2 فلتر المرحلة الثانية (Minervini)
    engines.vcp_detector          — #3 اكتشاف نموذج تقلص التقلب VCP (Minervini)
    engines.donchian_breakout     — #4 اختراق قنوات دونشيان (Turtles/Covel)
    engines.take_profit_tiers     — #5 جني أرباح تدريجي (Mark Douglas)

    confluence.confluence_scorer  — #6 محرك التلاقي v3 (يجمع الكل)

Author: GLMinvestment AI Beast
"""

__version__ = "3.0.0"
__all__ = ["core", "engines", "confluence", "backtest", "integration"]

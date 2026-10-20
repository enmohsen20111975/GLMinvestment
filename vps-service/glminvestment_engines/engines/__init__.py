"""
glminvestment_engines/engines/ — COMPATIBILITY SHIM (BRAVO STAGE-1 ENGINE-UNIFY)
===============================================================================
**Rule 67 + Rule 60 (MODULE-SYSTEM)**: تم نقل كل محتويات glminvestment_engines/engines/
لـ engines/ (canonical location). ده shim عشان backward compat — أي import من
glminvestment_engines.engines.X هيـ redirect لـ engines.X.

الـ canonical location دلوقتي: `vps-service/engines/`

استخدام قديم (لسه شغال):
    from glminvestment_engines.engines.atr_risk_engine import ...
    from glminvestment_engines.engines.vcp_detector import ...

استخدام جديد (canonical):
    from engines.atr_risk_engine import ...
    from engines.vcp_detector import ...

الـ shim بيـ re-export كل الـ public API من engines/ عشان الـ imports القديمة
تـ continue تشتغل بدون تغيير. لو أي import فشل، بـ يسجّل الـ error (مش silent crash).
"""
import logging

logger = logging.getLogger(__name__)

# قائمة الـ (module, names) لـ re-export
_REEXPORT_MAP = [
    ("engines.atr_risk_engine", ["analyze", "ATRRiskConfig", "compute_risk_plan"],
     ["analyze_atr_risk", "ATRRiskConfig", "compute_risk_plan"]),
    ("engines.stage2_filter", ["analyze", "Stage2Config", "classify_stage"],
     ["analyze_stage2", "Stage2Config", "classify_stage"]),
    ("engines.vcp_detector", ["analyze", "VCPConfig", "detect_vcp"],
     ["analyze_vcp", "VCPConfig", "detect_vcp"]),
    ("engines.donchian_breakout", ["analyze", "DonchianConfig", "detect_breakout"],
     ["analyze_donchian", "DonchianConfig", "detect_breakout"]),
    ("engines.take_profit_tiers",
     ["evaluate_position", "TakeProfitConfig", "ManagementDecision", "PositionAction", "position_from_risk_plan"],
     ["evaluate_position", "TakeProfitConfig", "ManagementDecision", "PositionAction", "position_from_risk_plan"]),
]

_failed = []
for _mod_path, _names, _aliases in _REEXPORT_MAP:
    try:
        _mod = __import__(_mod_path, fromlist=_names)
        for _orig, _alias in zip(_names, _aliases):
            globals()[_alias] = getattr(_mod, _orig)
    except Exception as _e:
        logger.error(
            "glminvestment_engines.engines shim: failed to re-export %s from %s: %s",
            _names, _mod_path, _e, exc_info=True
        )
        _failed.append(_mod_path)

if _failed:
    logger.warning(
        "glminvestment_engines.engines shim: %d/%d modules failed to re-export: %s",
        len(_failed), len(_REEXPORT_MAP), ", ".join(_failed)
    )

__all__ = [
    # ATR Risk
    "analyze_atr_risk", "ATRRiskConfig", "compute_risk_plan",
    # Stage 2
    "analyze_stage2", "Stage2Config", "classify_stage",
    # VCP
    "analyze_vcp", "VCPConfig", "detect_vcp",
    # Donchian
    "analyze_donchian", "DonchianConfig", "detect_breakout",
    # Take Profit
    "evaluate_position", "TakeProfitConfig", "ManagementDecision",
    "PositionAction", "position_from_risk_plan",
]

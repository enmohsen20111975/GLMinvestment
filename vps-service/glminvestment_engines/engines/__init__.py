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
تـ continue تشتغل بدون تغيير.
"""
# Re-export كل الـ public API من canonical engines/
from engines.atr_risk_engine import analyze as analyze_atr_risk, ATRRiskConfig, compute_risk_plan
from engines.stage2_filter import analyze as analyze_stage2, Stage2Config, classify_stage
from engines.vcp_detector import analyze as analyze_vcp, VCPConfig, detect_vcp
from engines.donchian_breakout import analyze as analyze_donchian, DonchianConfig, detect_breakout
from engines.take_profit_tiers import (
    evaluate_position, TakeProfitConfig, ManagementDecision,
    PositionAction, position_from_risk_plan,
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

"""Engines package — المحركات الخمسة لأساطير التداول."""
from .atr_risk_engine import analyze as analyze_atr_risk, ATRRiskConfig, compute_risk_plan
from .stage2_filter import analyze as analyze_stage2, Stage2Config, classify_stage
from .vcp_detector import analyze as analyze_vcp, VCPConfig, detect_vcp
from .donchian_breakout import analyze as analyze_donchian, DonchianConfig, detect_breakout
from .take_profit_tiers import (
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

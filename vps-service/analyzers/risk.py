"""
Risk Manager (CANONICAL — per-trade RiskAssessment)
====================================================
إدارة المخاطر — الطبقة الأساسية لكل صفقة على حدة

CANONICAL ROLE (UNIFY-RISK-TELEGRAM, Rule 54):
- This file is the canonical per-trade risk evaluator.
- Exposes `RiskAssessment` dataclass + `RiskManager` class.
- `RiskManager.evaluate_trade()` returns a RiskAssessment covering:
  position size, risk_amount, reward_amount, R:R ratio, signal quality.
- Imported by:
  * vps-service/api/public_routes.py    (instance = RiskManager())
  * vps-service/api/risk_routes.py       (fallback when advanced unavailable)
  * vps-service/analyzers/__init__.py    (re-exported as analyzers.RiskManager)

NOT TO BE CONFUSED WITH:
- analyzers/risk_adaptive.py            → adaptive stops based on signal/volatility
- analyzers/risk_manager.py             → supplementary (portfolio-level, forward-test only)
- vps-service/risk_management_advanced.py → advanced position-sizing + stop-loss API

Features:
- Position Size Calculation
- Risk-Reward Ratio
- Stop Loss Calculation
- Portfolio Risk Assessment

Author: دليل الاستثمار
"""

from typing import Dict, Optional
from dataclasses import dataclass
import math


@dataclass
class RiskAssessment:
    """Risk assessment for a trade."""
    entry_price: float
    target_price: Optional[float]
    stop_loss: Optional[float]
    
    # Position sizing
    position_size: int = 0
    position_value: float = 0.0
    
    # Risk metrics
    risk_amount: float = 0.0
    risk_percent: float = 0.0
    reward_amount: float = 0.0
    reward_percent: float = 0.0
    
    # Ratios
    risk_reward_ratio: float = 0.0
    
    # Signals
    signal: str = "HOLD"
    signal_quality: str = "NEUTRAL"
    warnings: list = None
    
    def to_dict(self) -> Dict:
        return {
            'entry_price': self.entry_price,
            'target_price': self.target_price,
            'stop_loss': self.stop_loss,
            'position_size': self.position_size,
            'position_value': round(self.position_value, 2),
            'risk_amount': round(self.risk_amount, 2),
            'risk_percent': round(self.risk_percent, 2),
            'reward_amount': round(self.reward_amount, 2) if self.reward_amount else None,
            'reward_percent': round(self.reward_percent, 2) if self.reward_percent else None,
            'risk_reward_ratio': round(self.risk_reward_ratio, 2) if self.risk_reward_ratio else None,
            'signal': self.signal,
            'signal_quality': self.signal_quality,
            'warnings': self.warnings or []
        }


class RiskManager:
    """
    Risk Management Engine.
    
    Usage:
        manager = RiskManager(capital=10000, risk_percent=2.0)
        assessment = manager.evaluate_trade(
            entry_price=100,
            target_price=110,
            stop_loss=95,
            signal="BUY"
        )
    """
    
    def __init__(self, capital: float = 10000, risk_percent: float = 2.0):
        """
        Initialize Risk Manager.
        
        Args:
            capital: Total trading capital
            risk_percent: Maximum risk per trade (1-5% recommended)
        """
        self.capital = capital
        self.risk_percent = min(max(risk_percent, 0.5), 10)  # Clamp 0.5-10%
    
    def evaluate_trade(
        self,
        entry_price: float,
        target_price: Optional[float] = None,
        stop_loss: Optional[float] = None,
        signal: str = "HOLD",
        support_level: Optional[float] = None,
        resistance_level: Optional[float] = None
    ) -> RiskAssessment:
        """
        Evaluate trade risk and calculate position size.
        
        Args:
            entry_price: Planned entry price
            target_price: Target price (optional)
            stop_loss: Stop loss price (optional)
            signal: Trading signal (BUY/SELL/HOLD)
            support_level: Support level for stop loss calculation
            resistance_level: Resistance level for target calculation
            
        Returns:
            RiskAssessment dataclass
        """
        assessment = RiskAssessment(
            entry_price=entry_price,
            target_price=target_price,
            stop_loss=stop_loss,
            warnings=[]
        )
        
        if signal == "HOLD" or entry_price <= 0:
            assessment.signal = "HOLD"
            return assessment
        
        # Calculate stop loss if not provided
        if not stop_loss:
            if signal == "BUY" and support_level:
                stop_loss = support_level * 0.98  # 2% below support
            elif signal == "SELL" and resistance_level:
                stop_loss = resistance_level * 1.02  # 2% above resistance
            else:
                stop_loss = entry_price * 0.95 if signal == "BUY" else entry_price * 1.05
        
        assessment.stop_loss = stop_loss
        
        # Calculate target if not provided
        if not target_price:
            risk_distance = abs(entry_price - stop_loss)
            target_price = entry_price + (risk_distance * 2) if signal == "BUY" else entry_price - (risk_distance * 2)
        
        assessment.target_price = target_price
        
        # Calculate position size
        risk_amount = self.capital * (self.risk_percent / 100)
        sl_distance = abs(entry_price - stop_loss)
        
        if sl_distance > 0:
            position_size = int(risk_amount / sl_distance)
        else:
            position_size = 0
        
        assessment.position_size = position_size
        assessment.position_value = position_size * entry_price
        assessment.risk_amount = risk_amount
        assessment.risk_percent = self.risk_percent
        
        # Calculate reward
        if signal == "BUY":
            assessment.reward_amount = (target_price - entry_price) * position_size
            assessment.reward_percent = ((target_price - entry_price) / entry_price) * 100
        else:
            assessment.reward_amount = (entry_price - target_price) * position_size
            assessment.reward_percent = ((entry_price - target_price) / entry_price) * 100
        
        # Calculate risk-reward ratio
        if assessment.risk_amount > 0:
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                assessment.risk_reward_ratio = compute_risk_reward(entry_price, target_price, stop_loss, fallback=assessment.reward_amount / assessment.risk_amount)
            except Exception:
                assessment.risk_reward_ratio = assessment.reward_amount / assessment.risk_amount
        
        # Determine signal quality
        assessment.signal = signal
        assessment.signal_quality = self._get_signal_quality(assessment.risk_reward_ratio)
        
        # Add warnings
        if assessment.risk_reward_ratio < 1.5:
            assessment.warnings.append("⚠️ Risk-reward ratio أقل من 1.5:1")
        if assessment.position_value > self.capital * 0.25:
            assessment.warnings.append("⚠️ حجم الصفقة أكثر من 25% من رأس المال")
        if sl_distance / entry_price > 0.1:
            assessment.warnings.append("⚠️ وقف الخسارة بعيد جداً (أكثر من 10%)")
        
        return assessment
    
    def _get_signal_quality(self, rr_ratio: float) -> str:
        """Get signal quality based on risk-reward ratio."""
        if rr_ratio >= 3:
            return "EXCELLENT"
        elif rr_ratio >= 2:
            return "GOOD"
        elif rr_ratio >= 1.5:
            return "ACCEPTABLE"
        elif rr_ratio >= 1:
            return "POOR"
        return "BAD"
    
    def calculate_position_size(
        self,
        entry_price: float,
        stop_loss: float,
        capital: float = None,
        risk_percent: float = None
    ) -> Dict:
        """
        Calculate position size only.
        
        Returns:
            Dict with position size details
        """
        cap = capital or self.capital
        risk_pct = risk_percent or self.risk_percent
        
        risk_amount = cap * (risk_pct / 100)
        sl_distance = abs(entry_price - stop_loss)
        
        if sl_distance <= 0:
            return {
                'shares': 0,
                'position_value': 0,
                'risk_amount': risk_amount,
                'error': 'Invalid stop loss'
            }
        
        shares = int(risk_amount / sl_distance)
        position_value = shares * entry_price
        
        return {
            'shares': shares,
            'position_value': round(position_value, 2),
            'risk_amount': round(risk_amount, 2),
            'risk_percent': risk_pct,
            'formula': f"Shares = ({cap} × {risk_pct}%) / {round(sl_distance, 4)} = {shares}"
        }
    
    def suggest_stop_loss(
        self,
        entry_price: float,
        support_level: Optional[float] = None,
        resistance_level: Optional[float] = None,
        signal: str = "BUY",
        atr: Optional[float] = None
    ) -> Dict:
        """
        Suggest stop loss level.
        
        Args:
            entry_price: Entry price
            support_level: Support level
            resistance_level: Resistance level
            signal: BUY or SELL
            atr: Average True Range (for volatility-based stop)
            
        Returns:
            Dict with suggested stop loss
        """
        suggestions = {}
        
        # Percentage-based
        if signal == "BUY":
            suggestions['percentage_based'] = entry_price * 0.95  # 5% below
        else:
            suggestions['percentage_based'] = entry_price * 1.05  # 5% above
        
        # Level-based
        if signal == "BUY" and support_level:
            suggestions['support_based'] = support_level * 0.98
        elif signal == "SELL" and resistance_level:
            suggestions['resistance_based'] = resistance_level * 1.02
        
        # ATR-based
        if atr:
            if signal == "BUY":
                suggestions['atr_based'] = entry_price - (atr * 2)
            else:
                suggestions['atr_based'] = entry_price + (atr * 2)
        
        # Recommended
        if signal == "BUY":
            candidates = [v for v in suggestions.values() if v and v < entry_price]
        else:
            candidates = [v for v in suggestions.values() if v and v > entry_price]
        
        suggestions['recommended'] = max(candidates) if signal == "BUY" and candidates else min(candidates) if candidates else suggestions['percentage_based']
        
        return suggestions

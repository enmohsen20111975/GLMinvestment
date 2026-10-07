"""
Portfolio Management Module
===========================
وحدة إدارة المحافظ الاحترافية

بناءً على PORTFOLIO_STRATEGY_BIBLE_v1.0.md

المكونات:
- PositionManager: إدارة المركز الواحد
- PortfolioHeatCalculator: حساب حرارة المحفظة
- EntryStrategies: استراتيجيات الدخول والتجميع
- TradeJournal: سجل الصفقات
- StopLossManager: أنواع الستوبات المختلفة

الاستخدام:
    from portfolio import PositionManager, PortfolioHeatCalculator
    
    manager = PositionManager(persona='balanced')
    result = manager.evaluate_position(entry_price, stop_loss, target)
"""

from .position_manager import PositionManager, PositionState, PositionLot
from .portfolio_heat import PortfolioHeatCalculator, PortfolioState
from .strategies import (
    EntryStrategies, 
    PlannedScaleInStrategy,
    PyramidUpStrategy,
    ThreeZoneHuntStrategy
)
from .trade_journal import TradeJournal, TradeEntry, TradeExit
from .stop_manager import StopLossManager, StopType

__all__ = [
    # Position Management
    'PositionManager', 'PositionState', 'PositionLot',
    # Portfolio Heat
    'PortfolioHeatCalculator', 'PortfolioState',
    # Entry Strategies
    'EntryStrategies', 'PlannedScaleInStrategy', 'PyramidUpStrategy', 'ThreeZoneHuntStrategy',
    # Trade Journal
    'TradeJournal', 'TradeEntry', 'TradeExit',
    # Stop Loss
    'StopLossManager', 'StopType'
]

__version__ = '1.0.0'

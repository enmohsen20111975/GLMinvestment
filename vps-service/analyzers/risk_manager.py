"""
Risk Manager - Portfolio Risk Control (SUPPLEMENTARY — forward-test script only)
================================================================================
مدير المخاطر - التحكم في مخاطر المحفظة (طبقة مساعدة، ليست في خط الإنتاج الرئيسي)

SUPPLEMENTARY ROLE (UNIFY-RISK-TELEGRAM, Rule 54 / Rule 16 — VERIFY-BEFORE-DELETE):
- This file is NOT in the main application pipeline.
- Exposes `RiskManager` (portfolio-level), `PortfolioRiskManager`, `PositionSizingResult`.
- Note: the `RiskManager` class here has a DIFFERENT signature than `analyzers/risk.py`
  (this one takes total_capital + regime-based stops; risk.py's takes capital + risk_percent).
- The `PositionSizingResult` dataclass is NOT imported anywhere outside this file
  (verified by grep). The `PortfolioRiskManager` class is imported by exactly ONE
  standalone CLI script:
  * vps-service/scripts/true_forward_test.py  (manual forward-testing utility)

WHY THIS FILE WAS NOT ARCHIVED:
- Rule 16 (VERIFY-BEFORE-DELETE): one importer exists (`scripts/true_forward_test.py`),
  so it is not strictly orphaned. Archiving this file alone would break that script.
- Future cleanup option: pair-archive this file together with `true_forward_test.py`
  if the forward-test script is retired.

CANONICAL ALTERNATIVES (use these instead for new code):
- Per-trade risk           → analyzers/risk.py            (RiskAssessment, RiskManager)
- Adaptive stops/targets   → analyzers/risk_adaptive.py   (RiskManagerAdaptive, RiskProfile)
- Position sizing + stops  → vps-service/risk_management_advanced.py (functional API)

Key Features:
1. Position Sizing - Max 5% per trade
2. Portfolio Heat - Max 30% total risk
3. Max Drawdown Protection
4. Correlation-aware position limits

@version 1.0.0
@authorM2yDevelopers Team
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum


class RiskLevel(Enum):
    LOW = 'low'
    MEDIUM = 'medium'
    HIGH = 'high'
    CRITICAL = 'critical'


@dataclass
class PositionSizingResult:
    """نتيجة حساب حجم المركز"""
    allowed: bool
    position_size_pct: float
    position_value: float
    max_loss_pct: float
    reason: str
    reason_ar: str
    warnings: List[str]


@dataclass
class PortfolioRiskState:
    """حالة مخاطر المحفظة"""
    total_capital: float
    total_exposure: float
    portfolio_heat: float  # % of capital at risk
    open_positions: int
    max_drawdown_pct: float
    risk_level: RiskLevel
    can_open_new: bool


# ==================== CONSTANTS ====================

# Position Sizing Rules
MAX_POSITION_SIZE_PCT = 5.0      # أقصى نسبة لسهم واحد = 5% من رأس المال
MAX_PORTFOLIO_HEAT = 30.0        # أقصى خسارة ممكنة للمحفظة = 30%
MAX_CORRELATED_POSITIONS = 2     # مفيش أكتر من 2 أسهم من نفس القطاع
MAX_OPEN_POSITIONS = 10          # أقصى عدد صفقات مفتوحة
MIN_CAPITAL_PER_TRADE = 5000     # أقل مبلغ للصفقة الواحدة (جنيه)

# Stop Loss by Regime
REGIME_STOP_LOSS = {
    'bull': 7.0,    # في السوق الصاعد - وقف خسارة ضيق
    'range': 5.0,   # في السوق المتراوح - وقف خسارة أضيق
    'bear': None,   # في السوق الهابط - مفيش إشارات جديدة
}

# Target by Regime
REGIME_TARGET = {
    'bull': 15.0,   # في السوق الصاعد - هدف أعلى
    'range': 8.0,   # في السوق المتراوح - هدف متوسط
    'bear': None,   # في السوق الهابط - مفيش إشارات جديدة
}

# Volume Filter by Regime
REGIME_VOLUME_FILTER = {
    'bull': 1.5,    # في السوق الصاعد - سيولة أعلى مطلوبة
    'range': 1.0,   # في السوق المتراوح - سيولة عادية
    'bear': 2.0,    # في السوق الهابط - سيولة عالية جداً مطلوبة (لو في إشارة)
}

# Min Score by Regime
REGIME_MIN_SCORE = {
    'bull': 70,     # في السوق الصاعد - درجة أدنى أعلى
    'range': 60,    # في السوق المتراوح - درجة أدنى متوسطة
    'bear': 85,     # في السوق الهابط - درجة أدنى عالية جداً (تقريباً مستحيل)
}


class RiskManager:
    """مدير المخاطر"""
    
    def __init__(
        self,
        total_capital: float,
        max_position_pct: float = MAX_POSITION_SIZE_PCT,
        max_portfolio_heat: float = MAX_PORTFOLIO_HEAT,
        max_correlated: int = MAX_CORRELATED_POSITIONS
    ):
        self.total_capital = total_capital
        self.max_position_pct = max_position_pct
        self.max_portfolio_heat = max_portfolio_heat
        self.max_correlated = max_correlated
        self.open_positions: List[Dict] = []
    
    def get_regime_params(self, regime: str) -> Dict:
        """الحصول على بارامترات حسب حالة السوق"""
        return {
            'stop_loss_pct': REGIME_STOP_LOSS.get(regime, 7.0),
            'target_pct': REGIME_TARGET.get(regime, 10.0),
            'volume_filter': REGIME_VOLUME_FILTER.get(regime, 1.0),
            'min_score': REGIME_MIN_SCORE.get(regime, 60),
            'can_trade': regime != 'bear'  # مفيش تداول في السوق الهابط
        }
    
    def calculate_position_size(
        self,
        entry_price: float,
        stop_loss_price: float,
        regime: str = 'range',
        maestro_score: float = 50,
        sector: str = None
    ) -> PositionSizingResult:
        """
        حساب حجم المركز المناسب
        
        Args:
            entry_price: سعر الدخول
            stop_loss_price: سعر وقف الخسارة
            regime: حالة السوق (bull/range/bear)
            maestro_score: درجة المايسترو (0-100)
            sector: قطاع السهم
        
        Returns:
            PositionSizingResult مع تفاصيل حجم المركز
        """
        warnings = []
        
        # 1. فحص حالة السوق
        regime_params = self.get_regime_params(regime)
        
        if regime == 'bear':
            return PositionSizingResult(
                allowed=False,
                position_size_pct=0,
                position_value=0,
                max_loss_pct=0,
                reason='Trading not allowed in bear market',
                reason_ar='التداول غير مسموح في السوق الهابط',
                warnings=['Bear regime - all new positions blocked']
            )
        
        # 2. فحص الدرجة
        min_score = regime_params['min_score']
        if maestro_score < min_score:
            return PositionSizingResult(
                allowed=False,
                position_size_pct=0,
                position_value=0,
                max_loss_pct=0,
                reason=f'Score {maestro_score} below minimum {min_score}',
                reason_ar=f'الدرجة {maestro_score} أقل من الحد الأدنى {min_score}',
                warnings=[f'Insufficient maestro score for {regime} regime']
            )
        
        # 3. حساب نسبة الخسارة
        if entry_price <= 0 or stop_loss_price <= 0:
            return PositionSizingResult(
                allowed=False,
                position_size_pct=0,
                position_value=0,
                max_loss_pct=0,
                reason='Invalid prices',
                reason_ar='أسعار غير صالحة',
                warnings=['Entry or stop loss price is zero or negative']
            )
        
        stop_loss_pct = abs((entry_price - stop_loss_price) / entry_price * 100)
        
        # 4. فحص عدد الصفقات المفتوحة
        if len(self.open_positions) >= MAX_OPEN_POSITIONS:
            return PositionSizingResult(
                allowed=False,
                position_size_pct=0,
                position_value=0,
                max_loss_pct=0,
                reason=f'Max positions reached ({MAX_OPEN_POSITIONS})',
                reason_ar=f'تم الوصول للحد الأقصى من الصفقات ({MAX_OPEN_POSITIONS})',
                warnings=['Close some positions before opening new ones']
            )
        
        # 5. فحص القطاع (Correlation)
        if sector:
            same_sector_count = sum(
                1 for pos in self.open_positions 
                if pos.get('sector') == sector
            )
            if same_sector_count >= self.max_correlated:
                return PositionSizingResult(
                    allowed=False,
                    position_size_pct=0,
                    position_value=0,
                    max_loss_pct=0,
                    reason=f'Max {self.max_correlated} positions from sector {sector}',
                    reason_ar=f'الحد الأقصى {self.max_correlated} أسهم من قطاع {sector}',
                    warnings=[f'Correlation limit reached for {sector} sector']
                )
        
        # 6. حساب حجم المركز
        # القاعدة: الخسارة المحتملة لا تتجاوز 1% من رأس المال لكل صفقة
        max_risk_per_trade = self.total_capital * 0.01  # 1% of capital
        position_value = max_risk_per_trade / (stop_loss_pct / 100)
        
        # تطبيق الحد الأقصى 5%
        max_position_value = self.total_capital * (self.max_position_pct / 100)
        position_value = min(position_value, max_position_value)
        position_size_pct = (position_value / self.total_capital) * 100
        
        # 7. فحص Portfolio Heat
        current_heat = self._calculate_portfolio_heat()
        new_heat_contribution = position_value * (stop_loss_pct / 100) / self.total_capital * 100
        
        if current_heat + new_heat_contribution > self.max_portfolio_heat:
            # تقليل حجم المركز
            allowed_heat = self.max_portfolio_heat - current_heat
            position_value = allowed_heat * self.total_capital / 100 / (stop_loss_pct / 100)
            position_size_pct = (position_value / self.total_capital) * 100
            warnings.append(f'Position reduced due to portfolio heat limit')
            warnings.append(f'Current heat: {current_heat:.1f}%, Max: {self.max_portfolio_heat}%')
        
        # 8. التحقق من الحد الأدنى
        if position_value < MIN_CAPITAL_PER_TRADE:
            warnings.append(f'Position value {position_value:.0f} below minimum {MIN_CAPITAL_PER_TRADE}')
        
        return PositionSizingResult(
            allowed=True,
            position_size_pct=round(position_size_pct, 2),
            position_value=round(position_value, 2),
            max_loss_pct=round(stop_loss_pct, 2),
            reason=f'Position approved for {regime} regime',
            reason_ar=f'المركز مسموح في السوق {regime}',
            warnings=warnings
        )
    
    def _calculate_portfolio_heat(self) -> float:
        """حساب المخاطر الإجمالية للمحفظة"""
        total_heat = 0
        for pos in self.open_positions:
            position_value = pos.get('value', 0)
            stop_loss_pct = pos.get('stop_loss_pct', 10)
            heat = position_value * (stop_loss_pct / 100) / self.total_capital * 100
            total_heat += heat
        return round(total_heat, 2)
    
    def get_portfolio_state(self) -> PortfolioRiskState:
        """الحصول على حالة المحفظة"""
        total_exposure = sum(pos.get('value', 0) for pos in self.open_positions)
        portfolio_heat = self._calculate_portfolio_heat()
        
        # تحديد مستوى المخاطر
        if portfolio_heat < 10:
            risk_level = RiskLevel.LOW
        elif portfolio_heat < 20:
            risk_level = RiskLevel.MEDIUM
        elif portfolio_heat < 30:
            risk_level = RiskLevel.HIGH
        else:
            risk_level = RiskLevel.CRITICAL
        
        return PortfolioRiskState(
            total_capital=self.total_capital,
            total_exposure=total_exposure,
            portfolio_heat=portfolio_heat,
            open_positions=len(self.open_positions),
            max_drawdown_pct=portfolio_heat,  # تقريبي
            risk_level=risk_level,
            can_open_new=portfolio_heat < self.max_portfolio_heat and len(self.open_positions) < MAX_OPEN_POSITIONS
        )
    
    def add_position(self, ticker: str, value: float, stop_loss_pct: float, sector: str = None):
        """إضافة مركز جديد"""
        self.open_positions.append({
            'ticker': ticker,
            'value': value,
            'stop_loss_pct': stop_loss_pct,
            'sector': sector
        })
    
    def remove_position(self, ticker: str):
        """إغلاق مركز"""
        self.open_positions = [
            pos for pos in self.open_positions 
            if pos.get('ticker') != ticker
        ]
    
    def check_correlation(
        self,
        ticker: str,
        sector: str
    ) -> Tuple[bool, List[str]]:
        """
        فحص الارتباط مع الصفقات المفتوحة
        
        Returns:
            (allowed, warnings)
        """
        warnings = []
        
        # فحص القطاع
        same_sector = [
            pos for pos in self.open_positions 
            if pos.get('sector') == sector
        ]
        
        if len(same_sector) >= self.max_correlated:
            tickers = [pos.get('ticker') for pos in same_sector]
            warnings.append(f'Already have {len(same_sector)} positions in {sector}: {tickers}')
            return False, warnings
        
        if same_sector:
            tickers = [pos.get('ticker') for pos in same_sector]
            warnings.append(f'Note: Already have positions in {sector}: {tickers}')
        
        return True, warnings
    
    def get_max_drawdown_limit(self) -> float:
        """الحد الأقصى للخسارة المقبولة (15% من رأس المال)"""
        return self.total_capital * 0.15
    
    def should_stop_trading(self, current_drawdown_pct: float) -> Tuple[bool, str]:
        """
        هل يجب التوقف عن التداول؟
        
        Args:
            current_drawdown_pct: نسبة الخسارة الحالية
        
        Returns:
            (should_stop, reason)
        """
        if current_drawdown_pct >= 15:
            return True, f'Drawdown {current_drawdown_pct:.1f}% exceeds 15% limit - STOP TRADING'
        elif current_drawdown_pct >= 10:
            return True, f'Drawdown {current_drawdown_pct:.1f}% warning - REDUCE POSITIONS'
        return False, 'Drawdown within acceptable limits'


# ==================== HELPER FUNCTIONS ====================

def calculate_stop_loss(
    entry_price: float,
    regime: str,
    atr_pct: float = None
) -> float:
    """
    حساب سعر وقف الخسارة حسب حالة السوق
    
    Args:
        entry_price: سعر الدخول
        regime: حالة السوق
        atr_pct: نسبة ATR (اختياري)
    
    Returns:
        سعر وقف الخسارة
    """
    if regime == 'bear':
        return None  # No trading in bear market
    
    stop_pct = REGIME_STOP_LOSS.get(regime, 7.0)
    
    # لو ATR متاح، نستخدمه
    if atr_pct and atr_pct > 0:
        # Stop Loss = 1.5 * ATR
        stop_pct = min(stop_pct, atr_pct * 1.5)
    
    return round(entry_price * (1 - stop_pct / 100), 2)


def calculate_target(
    entry_price: float,
    regime: str
) -> float:
    """
    حساب سعر الهدف حسب حالة السوق
    
    Args:
        entry_price: سعر الدخول
        regime: حالة السوق
    
    Returns:
        سعر الهدف
    """
    if regime == 'bear':
        return None  # No trading in bear market
    
    target_pct = REGIME_TARGET.get(regime, 10.0)
    return round(entry_price * (1 + target_pct / 100), 2)


def get_risk_adjusted_score(
    maestro_score: float,
    regime: str,
    volume_ratio: float
) -> float:
    """
    تعديل الدرجة حسب المخاطر
    
    Args:
        maestro_score: درجة المايسترو
        regime: حالة السوق
        volume_ratio: نسبة الحجم للمتوسط
    
    Returns:
        الدرجة المعدلة
    """
    adjusted = maestro_score
    
    # في السوق الصاعد، نحتاج سيولة أعلى
    if regime == 'bull':
        if volume_ratio < 1.5:
            adjusted -= 10  # عقوبة للسيولة المنخفضة في السوق الصاعد
    elif regime == 'range':
        if volume_ratio < 1.0:
            adjusted -= 5
    # في السوق الهابط، الدرجة تقل بشكل كبير
    elif regime == 'bear':
        adjusted *= 0.5
    
    return max(0, min(100, adjusted))


# ==================== PORTFOLIO RISK MANAGER (CMS Phase 1.5) ====================

class PortfolioRiskManager:
    """
    يدير المحفظة الافتراضية أثناء Forward Test
    
    القواعد الثابتة (مافيش parameters تتغير):
    - كل صفقة = 5% من رأس المال
    - كل قطاع = 3 صفقات × 5% = 15%
    - 6 صفقات × 5% = 30%
    """
    
    # القواعد الثابتة (مافيش parameters تتغير)
    MAX_POSITION_PCT = 5.0        # كل صفقة = 5% من رأس المال
    MAX_SECTOR_PCT = 15.0         # كل قطاع = 3 صفقات × 5% = 15%
    MAX_TOTAL_PCT = 30.0          # 6 صفقات × 5% = 30%
    MAX_POSITIONS = 6             # أقصى عدد صفقات مفتوحة
    MAX_SECTOR_POSITIONS = 3      # أقصى عدد صفقات لقطاع واحد
    
    def __init__(self, initial_capital: float = 1_000_000):
        self.initial_capital = initial_capital
        self.open_positions: List[Dict] = []
        self.closed_trades: List[Dict] = []
        self.daily_equity: List[Dict] = []
        self.peak_equity = initial_capital
        self.current_equity = initial_capital
    
    def can_enter_trade(
        self,
        ticker: str,
        sector: str,
        current_date: str,
        open_positions: List[Dict] = None
    ) -> Dict:
        """
        فحص هل مسموح بدخول صفقة جديدة
        
        Args:
            ticker: رمز السهم
            sector: القطاع
            current_date: التاريخ الحالي
            open_positions: قائمة الصفقات المفتوحة (اختياري)
        
        Returns:
            {
                "allowed": True/False,
                "reason": "ALLOW" / "MAX_POSITIONS_REACHED" / ...,
                "position_pct": 5.0 or 0.0
            }
        """
        positions = open_positions if open_positions is not None else self.open_positions
        
        # 1. Count total OPEN positions
        open_count = len(positions)
        if open_count >= self.MAX_POSITIONS:
            return {
                "allowed": False,
                "reason": "MAX_POSITIONS_REACHED",
                "position_pct": 0.0
            }
        
        # 2. Count OPEN positions in same sector
        same_sector_count = sum(
            1 for pos in positions 
            if pos.get('sector') == sector and pos.get('status') == 'OPEN'
        )
        if same_sector_count >= self.MAX_SECTOR_POSITIONS:
            return {
                "allowed": False,
                "reason": "MAX_SECTOR_EXPOSURE",
                "position_pct": 0.0
            }
        
        # 3. Calculate total exposure % of all OPEN positions
        total_exposure = sum(
            pos.get('position_pct', 5.0) for pos in positions 
            if pos.get('status') == 'OPEN'
        )
        if total_exposure + self.MAX_POSITION_PCT > self.MAX_TOTAL_PCT:
            return {
                "allowed": False,
                "reason": "MAX_PORTFOLIO_HEAT",
                "position_pct": 0.0
            }
        
        # 4. Check if same ticker already OPEN
        for pos in positions:
            if pos.get('ticker') == ticker and pos.get('status') == 'OPEN':
                return {
                    "allowed": False,
                    "reason": "DUPLICATE_TICKER",
                    "position_pct": 0.0
                }
        
        # 5. All passed
        return {
            "allowed": True,
            "reason": "ALLOW",
            "position_pct": self.MAX_POSITION_PCT
        }
    
    def update_on_exit(
        self,
        ticker: str,
        exit_date: str,
        exit_price: float
    ) -> Dict:
        """
        تحديث المحفظة عند إغلاق صفقة
        
        Args:
            ticker: رمز السهم
            exit_date: تاريخ الإغلاق
            exit_price: سعر الإغلاق
        
        Returns:
            تفاصيل الصفقة المغلقة
        """
        for pos in self.open_positions:
            if pos.get('ticker') == ticker and pos.get('status') == 'OPEN':
                # حساب PnL
                entry_price = pos.get('entry_price', 0)
                pnl_pct = ((exit_price - entry_price) / entry_price * 100) if entry_price > 0 else 0
                
                # تحديث الحالة
                pos['status'] = 'CLOSED'
                pos['exit_date'] = exit_date
                pos['exit_price'] = exit_price
                pos['pnl_pct'] = pnl_pct
                
                # نقل للصفقات المغلقة
                closed_trade = pos.copy()
                self.closed_trades.append(closed_trade)
                self.open_positions.remove(pos)
                
                # تحديث الـ Equity
                position_value = self.initial_capital * (pos.get('position_pct', 5.0) / 100)
                pnl_value = position_value * (pnl_pct / 100)
                self.current_equity += pnl_value
                
                return closed_trade
        
        return None
    
    def get_portfolio_stats(self) -> Dict:
        """
        الحصول على إحصائيات المحفظة
        
        Returns:
            {
                "initial_capital": 1000000.0,
                "current_equity": 950000.0,
                "total_exposure_pct": 25.0,
                "available_cash_pct": 70.0,
                "open_positions_count": 5,
                "max_drawdown_pct": 12.5,
                "closed_trades_count": 45,
                "closed_trades_pnl_pct": -5.0
            }
        """
        # حساب الـ exposure الحالي
        open_positions_list = [p for p in self.open_positions if p.get('status') == 'OPEN']
        total_exposure_pct = sum(p.get('position_pct', 5.0) for p in open_positions_list)
        
        # حساب الـ Drawdown
        if self.current_equity > self.peak_equity:
            self.peak_equity = self.current_equity
        
        drawdown_pct = 0.0
        if self.peak_equity > 0:
            drawdown_pct = ((self.peak_equity - self.current_equity) / self.peak_equity) * 100
        
        # حساب PnL الإجمالي للصفقات المغلقة
        total_pnl_pct = 0.0
        if self.closed_trades:
            total_pnl_pct = sum(t.get('pnl_pct', 0) for t in self.closed_trades) / len(self.closed_trades)
        
        return {
            "initial_capital": self.initial_capital,
            "current_equity": round(self.current_equity, 2),
            "total_exposure_pct": round(total_exposure_pct, 2),
            "available_cash_pct": round(100 - total_exposure_pct, 2),
            "open_positions_count": len(open_positions_list),
            "max_drawdown_pct": round(drawdown_pct, 2),
            "closed_trades_count": len(self.closed_trades),
            "closed_trades_pnl_pct": round(total_pnl_pct, 2)
        }
    
    def add_position(
        self,
        ticker: str,
        sector: str,
        entry_date: str,
        entry_price: float
    ) -> bool:
        """إضافة صفقة جديدة"""
        risk_check = self.can_enter_trade(ticker, sector, entry_date)
        
        if risk_check['allowed']:
            self.open_positions.append({
                "ticker": ticker,
                "sector": sector,
                "entry_date": entry_date,
                "entry_price": entry_price,
                "position_pct": self.MAX_POSITION_PCT,
                "status": "OPEN"
            })
            return True
        
        return False
    
    def calculate_equity(self) -> float:
        """حساب الـ Equity الحالي"""
        # ابدأ برأس المال
        equity = self.initial_capital
        
        # أضف أرباح/خسائر الصفقات المغلقة
        for trade in self.closed_trades:
            position_value = self.initial_capital * (trade.get('position_pct', 5.0) / 100)
            pnl_value = position_value * (trade.get('pnl_pct', 0) / 100)
            equity += pnl_value
        
        return equity
    
    def calculate_drawdown(self) -> float:
        """حساب الـ Drawdown الحالي"""
        current = self.calculate_equity()
        
        if current > self.peak_equity:
            self.peak_equity = current
        
        if self.peak_equity > 0:
            return ((self.peak_equity - current) / self.peak_equity) * 100
        
        return 0.0


# ==================== EXAMPLE USAGE ====================

if __name__ == '__main__':
    # مثال
    rm = RiskManager(total_capital=1_000_000)  # مليون جنيه
    
    # حالة المحفظة
    state = rm.get_portfolio_state()
    print(f"Portfolio Heat: {state.portfolio_heat}%")
    print(f"Can Open New: {state.can_open_new}")
    
    # حساب حجم المركز
    result = rm.calculate_position_size(
        entry_price=50,
        stop_loss_price=46.5,  # 7% stop loss
        regime='bull',
        maestro_score=75,
        sector='Financials'
    )
    
    print(f"\nPosition Allowed: {result.allowed}")
    print(f"Position Size: {result.position_size_pct}% = {result.position_value} EGP")
    print(f"Max Loss: {result.max_loss_pct}%")
    print(f"Reason: {result.reason_ar}")

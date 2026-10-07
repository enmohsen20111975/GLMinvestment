#!/usr/bin/env python3
"""
Crypto Circuit Breaker
======================

قاطع الدائرة للكريبتو - مختلف عن EGX:
- BTC نازل >8% = NO_SIGNALS
- Fear & Greed extremes
- Alt Season decisions

@authorM2yDevelopers Team
@version 1.0.0
"""

from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass
class CircuitBreakerResult:
    """نتيجة قاطع الدائرة"""
    triggered: bool
    level: str  # NONE, WARNING, CRITICAL, HALT
    action: str  # CONTINUE, REDUCE_SIZE, NO_NEW_ENTRIES, STOP_ALL
    reason: str
    reason_ar: str


class CryptoCircuitBreaker:
    """
    قاطع دائرة الكريبتو
    
    القواعد:
    - BTC نازل >8% في 24H → HALT (السوق كله بيموت)
    - Fear & Greed < 20 → OPPORTUNITY (بس بحذر)
    - Fear & Greed > 85 → NO_NEW_ENTRIES (فخ)
    - ALT Season Score > 75 → FOCUS_ALTS
    - BTC Dominance طالع >3% في أسبوع → FOCUS_BTC_ONLY
    """
    
    # Thresholds
    BTC_DROP_HALT = 8.0  # % drop in 24H triggers halt
    BTC_DROP_WARNING = 5.0
    
    FEAR_EXTREME_LOW = 20
    FEAR_EXTREME_HIGH = 85
    
    BTC_DOMINANCE_SURGE = 3.0  # % increase in week
    
    def __init__(self):
        self.last_btc_price = None
        self.last_btc_dominance = None
        self.last_check = None
    
    def check(
        self,
        btc_change_24h: float,
        fear_greed_index: int,
        btc_dominance: float,
        btc_dominance_change_week: float = 0
    ) -> CircuitBreakerResult:
        """
        فحص حالة السوق
        
        Args:
            btc_change_24h: تغير BTC في 24 ساعة (%)
            fear_greed_index: مؤشر الخوف والطمع (0-100)
            btc_dominance: هيمنة BTC (%)
            btc_dominance_change_week: تغير الهيمنة في أسبوع (%)
        
        Returns:
            CircuitBreakerResult مع القرار
        """
        
        # 1. BTC Major Drop = HALT
        if btc_change_24h <= -self.BTC_DROP_HALT:
            return CircuitBreakerResult(
                triggered=True,
                level="HALT",
                action="STOP_ALL",
                reason=f"BTC dropped {abs(btc_change_24h):.1f}% in 24H - Market crash",
                reason_ar=f"البيتكوين نزل {abs(btc_change_24h):.1f}% في 24 ساعة - انهيار السوق"
            )
        
        # 2. BTC Drop Warning
        if btc_change_24h <= -self.BTC_DROP_WARNING:
            return CircuitBreakerResult(
                triggered=True,
                level="WARNING",
                action="REDUCE_SIZE",
                reason=f"BTC dropped {abs(btc_change_24h):.1f}% - Reduce position sizes",
                reason_ar=f"البيتكوين نزل {abs(btc_change_24h):.1f}% - قلل أحجام المراكز"
            )
        
        # 3. Extreme Greed = No new entries
        if fear_greed_index >= self.FEAR_EXTREME_HIGH:
            return CircuitBreakerResult(
                triggered=True,
                level="CRITICAL",
                action="NO_NEW_ENTRIES",
                reason=f"Extreme Greed ({fear_greed_index}) - Risk of correction",
                reason_ar=f"طمع شديد ({fear_greed_index}) - خطر تصحيح حاد"
            )
        
        # 4. Extreme Fear = Opportunity (with caution)
        if fear_greed_index <= self.FEAR_EXTREME_LOW:
            return CircuitBreakerResult(
                triggered=False,
                level="WARNING",
                action="CONTINUE",
                reason=f"Extreme Fear ({fear_greed_index}) - Potential opportunity",
                reason_ar=f"خوف شديد ({fear_greed_index}) - فرصة محتملة (بحذر)"
            )
        
        # 5. BTC Dominance Surge = Focus BTC only
        if btc_dominance_change_week >= self.BTC_DOMINANCE_SURGE:
            return CircuitBreakerResult(
                triggered=True,
                level="WARNING",
                action="FOCUS_BTC_ONLY",
                reason=f"BTC Dominance surging ({btc_dominance:.1f}%) - Altcoins at risk",
                reason_ar=f"هيمنة البيتكوين بتطرد ({btc_dominance:.1f}%) - العملات البديلة في خطر"
            )
        
        # 6. High BTC Dominance = Caution on Alts
        if btc_dominance >= 55:
            return CircuitBreakerResult(
                triggered=False,
                level="WARNING",
                action="CONTINUE",
                reason=f"BTC Dominance high ({btc_dominance:.1f}%) - Be selective on Alts",
                reason_ar=f"هيمنة البيتكوين عالية ({btc_dominance:.1f}%) - حذر في العملات البديلة"
            )
        
        # All clear
        return CircuitBreakerResult(
            triggered=False,
            level="NONE",
            action="CONTINUE",
            reason="Market conditions normal",
            reason_ar="ظروف السوق طبيعية"
        )
    
    def check_for_coin(
        self,
        coin_symbol: str,
        btc_change_24h: float,
        fear_greed_index: int,
        btc_dominance: float
    ) -> CircuitBreakerResult:
        """
        فحص لعملة معينة
        
        Args:
            coin_symbol: رمز العملة (BTC, ETH, etc.)
            btc_change_24h: تغير BTC
            fear_greed_index: مؤشر الخوف
            btc_dominance: هيمنة BTC
        
        Returns:
            CircuitBreakerResult
        """
        
        # Get general market check
        result = self.check(btc_change_24h, fear_greed_index, btc_dominance)
        
        # Special handling for BTC itself
        if coin_symbol.upper() == "BTC":
            # BTC is safer during BTC season
            if result.action == "FOCUS_BTC_ONLY":
                return CircuitBreakerResult(
                    triggered=False,
                    level="NONE",
                    action="CONTINUE",
                    reason="BTC is the focus - Safer to trade",
                    reason_ar="البيتكوين هو التركيز - أكثر أماناً"
                )
        
        # Special handling for Altcoins
        else:
            # Alts are riskier during BTC dominance surge
            if btc_dominance >= 55 and btc_change_24h < -3:
                return CircuitBreakerResult(
                    triggered=True,
                    level="WARNING",
                    action="NO_NEW_ENTRIES",
                    reason=f"Altcoins at risk - BTC down {abs(btc_change_24h):.1f}%",
                    reason_ar=f"العملات البديلة في خطر - البيتكوين نزل {abs(btc_change_24h):.1f}%"
                )
        
        return result
    
    def get_position_size_multiplier(
        self,
        fear_greed_index: int,
        volatility: str
    ) -> float:
        """
        معامل حجم المركز حسب ظروف السوق
        
        Returns:
            0.0 = لا تدخل
            0.5 = نص الحجم
            1.0 = الحجم العادي
            1.5 = حجم أكبر (فرصة)
        """
        
        # Extreme Greed = Don't enter
        if fear_greed_index >= 85:
            return 0.0
        
        # Extreme Fear = Bigger position (opportunity)
        if fear_greed_index <= 25:
            return 1.2
        
        # High volatility = Smaller position
        if volatility == "HIGH":
            return 0.7
        
        return 1.0


# Convenience function
def check_crypto_circuit(
    btc_change_24h: float,
    fear_greed_index: int,
    btc_dominance: float
) -> CircuitBreakerResult:
    """Check crypto circuit breaker"""
    breaker = CryptoCircuitBreaker()
    return breaker.check(btc_change_24h, fear_greed_index, btc_dominance)


if __name__ == "__main__":
    print("=" * 60)
    print("CRYPTO CIRCUIT BREAKER TEST")
    print("=" * 60)
    
    # Test scenarios
    scenarios = [
        {"btc_change": -10, "fear": 40, "dominance": 52, "desc": "BTC Crash"},
        {"btc_change": -6, "fear": 45, "dominance": 52, "desc": "BTC Drop"},
        {"btc_change": 2, "fear": 90, "dominance": 52, "desc": "Extreme Greed"},
        {"btc_change": 1, "fear": 15, "dominance": 52, "desc": "Extreme Fear"},
        {"btc_change": 1, "fear": 50, "dominance": 58, "desc": "High BTC Dominance"},
        {"btc_change": 1, "fear": 50, "dominance": 45, "desc": "Normal Market"},
    ]
    
    for s in scenarios:
        result = check_crypto_circuit(
            s["btc_change"],
            s["fear"],
            s["dominance"]
        )
        
        print(f"\n📊 {s['desc']}:")
        print(f"   Level: {result.level}")
        print(f"   Action: {result.action}")
        print(f"   Reason: {result.reason_ar}")

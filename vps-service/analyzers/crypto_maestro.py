#!/usr/bin/env python3
"""
Crypto Maestro Orchestrator
===========================

المايسترو للعملات الرقمية - مختلف عن EGX:
- Stop Loss: 15-20% (أوسع)
- Target: 25-40% (أعلى)
- Position Size: 3% max (أصغر)
- Max Positions: 10 (أكثر)
- Timeframes: 1H, 4H, D (أسرع)

@authorM2yDevelopers Team
@version 1.0.0
"""

import sys
import os
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime

# Add parent directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.crypto_analyzer import CryptoAnalyzer, CryptoAnalysis, OHLCV
from analyzers.crypto_regime import CryptoRegimeDetector, CryptoRegime
from analyzers.crypto_circuit import CryptoCircuitBreaker, CircuitBreakerResult


# ============================================================================
# CONSTANTS - CRYPTO SPECIFIC
# ============================================================================

# Position Sizing (أصغر من EGX بسبب التقلب العالي)
MAX_POSITION_PCT = 3.0  # كل صفقة = 3% من رأس المال
MAX_TOTAL_EXPOSURE = 30.0  # 10 صفقات × 3% = 30%
MAX_POSITIONS = 10  # أقصى عدد صفقات مفتوحة
MAX_SECTOR_POSITIONS = 3  # أقصى صفقات لكل قطاع

# Stop Loss & Target (أوسع من EGX)
REGIME_STOP_LOSS = {
    'bull': 15.0,    # في السوق الصاعد
    'range': 12.0,   # في السوق المتراوح
    'bear': 20.0,    # في السوق الهابط
    'high_vol': 25.0,  # تقلب عالي
}

REGIME_TARGET = {
    'bull': 40.0,    # في السوق الصاعد
    'range': 25.0,   # في السوق المتراوح
    'bear': 20.0,    # في السوق الهابط
    'high_vol': 50.0,  # تقلب عالي = فرص كبيرة
}

# Min Score Thresholds
MIN_SCORE_TO_TRADE = 60
MIN_SCORE_STRONG_BUY = 80

# Risk/Reward
MIN_RISK_REWARD = 2.0


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class CryptoMaestroResult:
    """نتيجة المايسترو للكريبتو"""
    coin_id: str
    symbol: str
    name: str
    timestamp: str
    
    # Scores
    maestro_score: float  # 0-100
    confidence: float  # 0-100
    
    # Signal
    signal: str  # STRONG_BUY, BUY, HOLD, SELL, STRONG_SELL, NO_SIGNAL
    signal_ar: str
    
    # Prices
    current_price: float
    entry_price: float
    stop_loss: float
    target: float
    risk_reward: float
    
    # Position
    position_size_pct: float
    
    # Regime
    market_regime: str
    fear_greed: int
    btc_dominance: float
    
    # Circuit Breaker
    circuit_breaker: str
    
    # Reasons
    reasons: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    
    # Raw analysis
    raw_analysis: Optional[CryptoAnalysis] = None
    raw_regime: Optional[CryptoRegime] = None
    raw_circuit: Optional[CircuitBreakerResult] = None


# ============================================================================
# CRYPTO MAESTRO
# ============================================================================

class CryptoMaestroOrchestrator:
    """
    المايسترو للعملات الرقمية
    
    الفروقات عن EGX:
    - 24/7 trading
    - Stop Loss أوسع (15-25%)
    - Target أعلى (25-50%)
    - Position Size أصغر (3%)
    - مراعاة BTC Dominance و Fear & Greed
    """
    
    def __init__(self):
        self.analyzer = CryptoAnalyzer()
        self.regime_detector = CryptoRegimeDetector()
        self.circuit_breaker = CryptoCircuitBreaker()
    
    def analyze(self, coin_id: str) -> Optional[CryptoMaestroResult]:
        """
        تحليل عملة رقمية
        
        Args:
            coin_id: معرف العملة (bitcoin, ethereum, etc.)
        
        Returns:
            CryptoMaestroResult أو None
        """
        
        # 1. Get basic analysis
        crypto_analysis = self.analyzer.analyze(coin_id)
        if not crypto_analysis:
            return None
        
        # 2. Get market regime
        regime = self.regime_detector.detect_regime()
        
        # 3. Calculate BTC change (simplified - would need real data)
        btc_change_24h = 0.0  # Placeholder
        
        # 4. Check circuit breaker
        circuit = self.circuit_breaker.check(
            btc_change_24h=btc_change_24h,
            fear_greed_index=regime.fear_greed_index,
            btc_dominance=regime.btc_dominance
        )
        
        # 5. Calculate Maestro Score
        maestro_score = self._calculate_maestro_score(
            crypto_analysis, regime, circuit
        )
        
        # 6. Determine signal
        signal, signal_ar = self._determine_signal(
            maestro_score, circuit, regime
        )
        
        # 7. Calculate prices
        current_price = crypto_analysis.current_price
        stop_loss_pct = self._get_stop_loss_pct(regime, crypto_analysis)
        target_pct = self._get_target_pct(regime, crypto_analysis)
        
        stop_loss = current_price * (1 - stop_loss_pct / 100)
        target = current_price * (1 + target_pct / 100)
        entry_price = current_price * 0.995  # Slightly below current
        
        risk_reward = (target - entry_price) / (entry_price - stop_loss) if entry_price > stop_loss else 0
        
        # 8. Calculate position size
        position_size = self._calculate_position_size(regime, circuit)
        
        # 9. Build reasons and warnings
        reasons = crypto_analysis.reasons.copy()
        warnings = crypto_analysis.warnings.copy()
        
        # Add regime reasons
        if regime.fear_greed_index <= 25:
            reasons.append(f"Extreme Fear ({regime.fear_greed_index}) = Opportunity")
        elif regime.fear_greed_index >= 75:
            warnings.append(f"Extreme Greed ({regime.fear_greed_index}) = Caution")
        
        # Add circuit breaker warnings
        if circuit.triggered:
            warnings.append(f"Circuit Breaker: {circuit.reason_ar}")
        
        return CryptoMaestroResult(
            coin_id=crypto_analysis.coin_id,
            symbol=crypto_analysis.symbol,
            name=crypto_analysis.name,
            timestamp=datetime.now().isoformat(),
            maestro_score=maestro_score,
            confidence=crypto_analysis.confidence,
            signal=signal,
            signal_ar=signal_ar,
            current_price=current_price,
            entry_price=round(entry_price, 4),
            stop_loss=round(stop_loss, 4),
            target=round(target, 4),
            risk_reward=round(risk_reward, 2),
            position_size_pct=position_size,
            market_regime=regime.regime,
            fear_greed=regime.fear_greed_index,
            btc_dominance=regime.btc_dominance,
            circuit_breaker=circuit.action,
            reasons=reasons,
            warnings=warnings,
            raw_analysis=crypto_analysis,
            raw_regime=regime,
            raw_circuit=circuit
        )
    
    def _calculate_maestro_score(
        self,
        analysis: CryptoAnalysis,
        regime: CryptoRegime,
        circuit: CircuitBreakerResult
    ) -> float:
        """حساب درجة المايسترو"""
        
        # Base score from analysis
        score = 50.0
        
        # Add analysis score (scaled to 0-100)
        if analysis.overall_score >= 4:
            score += 20
        elif analysis.overall_score >= 2:
            score += 10
        elif analysis.overall_score >= 0:
            score += 0
        elif analysis.overall_score >= -2:
            score -= 10
        else:
            score -= 20
        
        # Technical score contribution
        tech_score = analysis.technical_score
        score += tech_score * 2  # Scale up
        
        # Fundamental score contribution
        fund_score = analysis.fundamental_score
        score += fund_score * 2
        
        # Regime adjustments
        if regime.fear_greed_index <= 25:
            score += 10  # Opportunity
        elif regime.fear_greed_index >= 75:
            score -= 10  # Caution
        
        # Circuit breaker penalty
        if circuit.triggered:
            if circuit.action == "STOP_ALL":
                score = 0
            elif circuit.action == "NO_NEW_ENTRIES":
                score -= 30
            elif circuit.action == "REDUCE_SIZE":
                score -= 15
        
        # Alt season bonus for alts
        if regime.alt_season_score >= 75 and analysis.coin_id != "bitcoin":
            score += 10
        
        # BTC season bonus for BTC
        if regime.btc_dominance >= 55 and analysis.coin_id == "bitcoin":
            score += 10
        
        return max(0, min(100, round(score, 2)))
    
    def _determine_signal(
        self,
        score: float,
        circuit: CircuitBreakerResult,
        regime: CryptoRegime
    ) -> tuple:
        """تحديد الإشارة"""
        
        # Circuit breaker overrides
        if circuit.action == "STOP_ALL":
            return "NO_SIGNAL", "ممنوع التداول"
        
        if circuit.action == "NO_NEW_ENTRIES":
            return "HOLD", "احتفاظ - ظروف السوق خطرة"
        
        # Score-based decision
        if score >= MIN_SCORE_STRONG_BUY:
            signal = "STRONG_BUY"
            signal_ar = "شراء قوي"
        elif score >= MIN_SCORE_TO_TRADE:
            signal = "BUY"
            signal_ar = "شراء"
        elif score >= 40:
            signal = "HOLD"
            signal_ar = "احتفاظ"
        elif score >= 20:
            signal = "SELL"
            signal_ar = "بيع"
        else:
            signal = "STRONG_SELL"
            signal_ar = "بيع قوي"
        
        # Extreme fear opportunity
        if regime.fear_greed_index <= 25 and signal in ["HOLD", "BUY", "STRONG_BUY"]:
            signal_ar = "شراء (فرصة)"
        
        return signal, signal_ar
    
    def _get_stop_loss_pct(
        self,
        regime: CryptoRegime,
        analysis: CryptoAnalysis
    ) -> float:
        """حساب نسبة وقف الخسارة"""
        
        # Base on volatility
        if regime.volatility_regime == "HIGH":
            return REGIME_STOP_LOSS['high_vol']
        
        # Base on regime
        if regime.regime in ["BTC_SEASON", "EXTREME_FEAR"]:
            return REGIME_STOP_LOSS['range']
        
        if regime.regime == "ALT_SEASON":
            return REGIME_STOP_LOSS['bull']
        
        # Default
        return REGIME_STOP_LOSS['range']
    
    def _get_target_pct(
        self,
        regime: CryptoRegime,
        analysis: CryptoAnalysis
    ) -> float:
        """حساب نسبة الهدف"""
        
        # High volatility = higher targets
        if regime.volatility_regime == "HIGH":
            return REGIME_TARGET['high_vol']
        
        # Alt season = alts can fly
        if regime.alt_season_score >= 75:
            return REGIME_TARGET['bull']
        
        # Default
        return REGIME_TARGET['range']
    
    def _calculate_position_size(
        self,
        regime: CryptoRegime,
        circuit: CircuitBreakerResult
    ) -> float:
        """حساب حجم المركز"""
        
        # Circuit breaker adjustment
        if circuit.action == "REDUCE_SIZE":
            return MAX_POSITION_PCT * 0.5
        
        # Risk multiplier from regime
        risk_mult = self.regime_detector.get_risk_multiplier()
        
        position = MAX_POSITION_PCT * risk_mult
        
        return round(max(1.0, min(5.0, position)), 2)
    
    def analyze_top(self, limit: int = 20) -> List[CryptoMaestroResult]:
        """تحليل أفضل العملات"""
        
        results = []
        cryptos = self.analyzer.fetcher.get_top_cryptos(limit)
        
        for crypto in cryptos:
            try:
                result = self.analyze(crypto.coin_id)
                if result:
                    results.append(result)
            except Exception as e:
                print(f"Error analyzing {crypto.coin_id}: {e}")
        
        return sorted(results, key=lambda x: x.maestro_score, reverse=True)
    
    def get_quick_scan(self) -> List[Dict]:
        """فحص سريع للفرص"""
        
        results = self.analyze_top(50)
        
        opportunities = []
        for r in results:
            if r.signal in ["STRONG_BUY", "BUY"] and r.maestro_score >= MIN_SCORE_TO_TRADE:
                opportunities.append({
                    "symbol": r.symbol,
                    "name": r.name,
                    "price": r.current_price,
                    "signal": r.signal,
                    "score": r.maestro_score,
                    "entry": r.entry_price,
                    "target": r.target,
                    "stop_loss": r.stop_loss,
                    "r:r": r.risk_reward,
                    "position_pct": r.position_size_pct,
                    "reasons": r.reasons[:2]
                })
        
        return opportunities[:10]


# Convenience function
def analyze_crypto(coin_id: str) -> Optional[CryptoMaestroResult]:
    """Analyze a cryptocurrency"""
    maestro = CryptoMaestroOrchestrator()
    return maestro.analyze(coin_id)


if __name__ == "__main__":
    print("=" * 70)
    print("CRYPTO MAESTRO TEST")
    print("=" * 70)
    
    maestro = CryptoMaestroOrchestrator()
    
    # Test with Bitcoin
    print("\n📊 Analyzing Bitcoin...")
    result = maestro.analyze("bitcoin")
    
    if result:
        print(f"\n💰 {result.name} ({result.symbol})")
        print(f"   السعر: ${result.current_price:,.2f}")
        print(f"\n🎯 الإشارة: {result.signal_ar}")
        print(f"   الدرجة: {result.maestro_score}")
        print(f"   الثقة: {result.confidence:.0f}%")
        print(f"\n📍 الأسعار:")
        print(f"   الدخول: ${result.entry_price:,.2f}")
        print(f"   الهدف: ${result.target:,.2f}")
        print(f"   الاستوب: ${result.stop_loss:,.2f}")
        print(f"   R:R: 1:{result.risk_reward}")
        print(f"\n📊 السوق:")
        print(f"   Regime: {result.market_regime}")
        print(f"   Fear & Greed: {result.fear_greed}")
        print(f"   BTC Dominance: {result.btc_dominance:.1f}%")
    else:
        print("Could not fetch Bitcoin data")

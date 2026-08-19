#!/usr/bin/env python3
"""
Crypto Regime Detector
======================

يكشف حالة سوق الكريبتو (مختلف عن EGX):
- BTC Dominance Trend
- Fear & Greed Index
- Altcoin Season
- Volatility Regime

@authorM2yDevelopers Team
@version 1.0.0
"""

import urllib.request
import urllib.error
import json
from datetime import datetime
from typing import Dict, Optional
from dataclasses import dataclass


@dataclass
class CryptoRegime:
    """نتيجة كشف حالة سوق الكريبتو"""
    regime: str  # BTC_SEASON, ALT_SEASON, HIGH_VOL, LOW_VOL, EXTREME_FEAR, EXTREME_GREED
    btc_dominance: float
    fear_greed_index: int  # 0-100
    alt_season_score: int  # 0-100
    volatility_regime: str  # HIGH, MEDIUM, LOW
    signal: str  # OPPORTUNITY, CAUTION, NEUTRAL, NO_TRADE
    reasons: list


class CryptoRegimeDetector:
    """كاشف حالة سوق الكريبتو"""
    
    # APIs
    FEAR_GREED_API = "https://api.alternative.me/fng/"
    COINGECKO_GLOBAL = "https://api.coingecko.com/api/v3/global"
    
    # Thresholds
    EXTREME_FEAR_THRESHOLD = 25
    EXTREME_GREED_THRESHOLD = 75
    BTC_DOMINANCE_HIGH = 55.0
    BTC_DOMINANCE_LOW = 40.0
    ALT_SEASON_THRESHOLD = 75
    
    def __init__(self):
        self.cache = {}
        self.cache_time = {}
        self.cache_duration = 300  # 5 minutes
    
    def _fetch(self, url: str) -> Dict:
        """Fetch data with caching"""
        import time
        
        now = time.time()
        if url in self.cache and url in self.cache_time:
            if now - self.cache_time[url] < self.cache_duration:
                return self.cache[url]
        
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            })
            with urllib.request.urlopen(req, timeout=30) as response:
                data = json.loads(response.read().decode())
                self.cache[url] = data
                self.cache_time[url] = now
                return data
        except Exception as e:
            print(f"Error fetching {url}: {e}")
            return {}
    
    def get_fear_greed_index(self) -> int:
        """الحصول على مؤشر الخوف والطمع"""
        try:
            data = self._fetch(self.FEAR_GREED_API)
            if data and 'data' in data and len(data['data']) > 0:
                return int(data['data'][0]['value'])
        except:
            pass
        return 50  # Default neutral
    
    def get_btc_dominance(self) -> float:
        """الحصول على هيمنة البيتكوين"""
        try:
            data = self._fetch(self.COINGECKO_GLOBAL)
            if data and 'data' in data:
                return float(data['data']['market_cap_percentage'].get('btc', 50))
        except:
            pass
        return 50.0  # Default
    
    def get_alt_season_score(self) -> int:
        """
        حساب درجة موسم العملات البديلة
        
        Alt Season = عندما الألتكوينز بتتفوق على البيتكوين
        """
        # This would need historical BTC vs ALT comparison
        # For now, use a simplified calculation based on dominance
        btc_dom = self.get_btc_dominance()
        
        # Lower BTC dominance = Higher Alt Season
        if btc_dom > 55:
            return 25  # Bitcoin Season
        elif btc_dom > 45:
            return 50  # Neutral
        else:
            return 75  # Alt Season
    
    def calculate_volatility(self) -> str:
        """
        حساب مستوى التقلب
        
        بنعتمد على تغيرات الـ 24 ساعة
        """
        try:
            data = self._fetch(self.COINGECKO_GLOBAL)
            if data and 'data' in data:
                change_24h = data['data'].get('market_cap_change_percentage_24h_usd', 0)
                
                if abs(change_24h) > 10:
                    return "HIGH"
                elif abs(change_24h) > 5:
                    return "MEDIUM"
                else:
                    return "LOW"
        except:
            pass
        return "MEDIUM"
    
    def detect_regime(self) -> CryptoRegime:
        """
        كشف حالة السوق الكاملة
        
        Returns:
            CryptoRegime مع كل المؤشرات
        """
        fear_greed = self.get_fear_greed_index()
        btc_dominance = self.get_btc_dominance()
        alt_season = self.get_alt_season_score()
        volatility = self.calculate_volatility()
        
        reasons = []
        regime = "NEUTRAL"
        signal = "NEUTRAL"
        
        # 1. Extreme Fear = Opportunity
        if fear_greed <= self.EXTREME_FEAR_THRESHOLD:
            regime = "EXTREME_FEAR"
            signal = "OPPORTUNITY"
            reasons.append(f"Extreme Fear ({fear_greed}) = Buying Opportunity")
        
        # 2. Extreme Greed = Caution
        elif fear_greed >= self.EXTREME_GREED_THRESHOLD:
            regime = "EXTREME_GREED"
            signal = "NO_TRADE"
            reasons.append(f"Extreme Greed ({fear_greed}) = Risk of Correction")
        
        # 3. Bitcoin Season
        if btc_dominance >= self.BTC_DOMINANCE_HIGH:
            if regime == "NEUTRAL":
                regime = "BTC_SEASON"
            signal = "FOCUS_BTC"
            reasons.append(f"BTC Dominance High ({btc_dominance:.1f}%) = Focus on Bitcoin")
        
        # 4. Alt Season
        elif btc_dominance <= self.BTC_DOMINANCE_LOW:
            if regime == "NEUTRAL":
                regime = "ALT_SEASON"
            signal = "FOCUS_ALTS"
            reasons.append(f"BTC Dominance Low ({btc_dominance:.1f}%) = Altcoin Season")
        
        # 5. High Volatility
        if volatility == "HIGH":
            if regime == "NEUTRAL":
                regime = "HIGH_VOL"
            reasons.append("High Volatility = Use Wider Stops")
            if signal == "NEUTRAL":
                signal = "CAUTION"
        
        # 6. Alt Season Score
        if alt_season >= self.ALT_SEASON_THRESHOLD:
            reasons.append(f"Alt Season Score ({alt_season}) = Alts Outperforming")
        
        return CryptoRegime(
            regime=regime,
            btc_dominance=btc_dominance,
            fear_greed_index=fear_greed,
            alt_season_score=alt_season,
            volatility_regime=volatility,
            signal=signal,
            reasons=reasons
        )
    
    def should_trade(self) -> tuple:
        """
        هل يجب التداول الآن؟
        
        Returns:
            (allowed, reason)
        """
        regime = self.detect_regime()
        
        if regime.regime == "EXTREME_GREED":
            return False, "Extreme Greed - Risk of major correction"
        
        if regime.volatility_regime == "HIGH" and regime.fear_greed_index < 30:
            return False, "High volatility + Fear = Unpredictable"
        
        return True, regime.signal
    
    def get_risk_multiplier(self) -> float:
        """
        معامل المخاطرة حسب حالة السوق
        
        Returns:
            0.5 = خفض المخاطرة
            1.0 = عادي
            1.5 = زيادة المخاطرة (فرصة)
        """
        regime = self.detect_regime()
        
        # Extreme Fear = Good opportunity
        if regime.fear_greed_index <= 25:
            return 1.2
        
        # Extreme Greed = Reduce risk
        if regime.fear_greed_index >= 75:
            return 0.5
        
        # High Volatility = Reduce risk
        if regime.volatility_regime == "HIGH":
            return 0.7
        
        return 1.0


# Convenience function
def get_crypto_regime() -> CryptoRegime:
    """Get current crypto market regime"""
    detector = CryptoRegimeDetector()
    return detector.detect_regime()


if __name__ == "__main__":
    print("=" * 60)
    print("CRYPTO MARKET REGIME")
    print("=" * 60)
    
    regime = get_crypto_regime()
    
    print(f"\n📊 Regime: {regime.regime}")
    print(f"💰 BTC Dominance: {regime.btc_dominance:.1f}%")
    print(f"😨 Fear & Greed: {regime.fear_greed_index}")
    print(f"🚀 Alt Season Score: {regime.alt_season_score}")
    print(f"📈 Volatility: {regime.volatility_regime}")
    print(f"\n🎯 Signal: {regime.signal}")
    
    if regime.reasons:
        print("\n📝 Reasons:")
        for r in regime.reasons:
            print(f"   • {r}")

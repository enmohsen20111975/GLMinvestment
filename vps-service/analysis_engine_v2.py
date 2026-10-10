#!/usr/bin/env python3
"""
Analysis Engine V2 - Plugin-Based Architecture
================================================
محرك تحليلي مبني على نظام Plugin

كل محرك (Fundamental, Technical, Candlestick, MeanReversion) منفصل:
- ON/OFF toggle
- وزن قابل للتعديل (weight)
- Pipeline مركزي يحسب النتيجة النهائية

Architecture:
┌────────────────────────────────────────────┐
│           AnalysisOrchestrator              │
├────────────────────────────────────────────┤
│  Engines (4 plugins):                      │
│  ┌──────────┐┌──────────┐┌──────────┐┌────┐│
│  │Fundamen- ││Technical ││Candle-   ││Mean││
│  │tal       ││         ││stick     ││Rev ││
│  │ON/OFF    ││ON/OFF   ││ON/OFF    ││ON/ ││
│  │weight=x  ││weight=x ││weight=x  │OFF ││
│  └──────────┘└──────────┘└──────────┘└────┘│
├────────────────────────────────────────────┤
│  Presets:                                   │
│  • EGX Conservative   (للمستثمر)            │
│  • EGX Aggressive     (للمضارب)             │
│  • EGX Balanced       (مزيج)                │
│  • Crypto Scalp       (للكريبتو)            │
└────────────────────────────────────────────┘

Author: دليل الاستثمار - M2Y Developers
Version: 2.0.0
"""

import os
import json
import time
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any, Type
from dataclasses import dataclass, field, asdict
from abc import ABC, abstractmethod
from pathlib import Path


# ============================================================================
# BASE ENGINE PLUGIN
# ============================================================================

class BaseEnginePlugin(ABC):
    """Base class for all analysis engine plugins."""
    
    name: str = "base"
    display_name: str = "Base Engine"
    description: str = ""
    
    def __init__(self, enabled: bool = True, weight: float = 1.0):
        self.enabled = enabled
        self.weight = weight
    
    @abstractmethod
    def analyze(self, ticker: str, stock_data: Dict) -> Dict:
        """
        Analyze a stock and return results.
        
        Returns:
            {
                "signal": "BUY" | "SELL" | "HOLD",
                "score": float (0-10),
                "confidence": float (0-100),
                "details": {...},
                "reasons": [...],
            }
        """
        pass
    
    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "enabled": self.enabled,
            "weight": self.weight,
        }


# ============================================================================
# FUNDAMENTAL ENGINE PLUGIN
# ============================================================================

class FundamentalEngine(BaseEnginePlugin):
    """Fundamental Analysis Plugin - التحليل الأساسي"""
    
    name = "fundamental"
    display_name = "Fundamental Engine"
    description = "تحليل أساسي - P/E, ROE, EPS, Profit Margins, Debt Ratios"
    
    def __init__(self, enabled: bool = True, weight: float = 1.0):
        super().__init__(enabled, weight)
    
    def analyze(self, ticker: str, stock_data: Dict) -> Dict:
        if not self.enabled:
            return {"signal": "HOLD", "score": 0, "confidence": 0, "details": {}, "reasons": ["Engine disabled"]}
        
        score = 5.0  # Neutral start
        reasons = []
        details = {}
        
        # P/E Ratio
        pe = stock_data.get('pe_ratio')
        if pe is not None:
            details['pe_ratio'] = pe
            if pe < 0:
                reasons.append(f"P/E negative ({pe:.1f}) - company losing money")
                score -= 1.5
            elif pe < 10:
                reasons.append(f"P/E undervalued ({pe:.1f})")
                score += 1.5
            elif pe < 20:
                reasons.append(f"P/E fair value ({pe:.1f})")
                score += 0.5
            elif pe < 35:
                reasons.append(f"P/E slightly overvalued ({pe:.1f})")
                score -= 0.5
            else:
                reasons.append(f"P/E overvalued ({pe:.1f})")
                score -= 1.5
        
        # ROE
        roe = stock_data.get('roe')
        if roe is not None:
            details['roe'] = roe
            if roe > 20:
                reasons.append(f"Excellent ROE ({roe:.1f}%)")
                score += 1.5
            elif roe > 10:
                reasons.append(f"Good ROE ({roe:.1f}%)")
                score += 0.5
            elif roe > 0:
                reasons.append(f"Low ROE ({roe:.1f}%)")
                score -= 0.5
            else:
                reasons.append(f"Negative ROE ({roe:.1f}%)")
                score -= 1.5
        
        # EPS
        eps = stock_data.get('eps')
        if eps is not None:
            details['eps'] = eps
            if eps > 0:
                reasons.append(f"Positive EPS ({eps:.2f})")
                score += 0.5
            else:
                reasons.append(f"Negative EPS ({eps:.2f})")
                score -= 1.0
        
        # Profit Margin
        pm = stock_data.get('profit_margin')
        if pm is not None:
            details['profit_margin'] = pm
            if pm > 20:
                reasons.append(f"High profit margin ({pm:.1f}%)")
                score += 1.0
            elif pm > 10:
                reasons.append(f"Decent profit margin ({pm:.1f}%)")
                score += 0.3
            elif pm > 0:
                reasons.append(f"Low profit margin ({pm:.1f}%)")
                score -= 0.3
            else:
                reasons.append(f"Negative margin ({pm:.1f}%)")
                score -= 1.0
        
        # Debt to Equity
        dte = stock_data.get('debt_to_equity')
        if dte is not None:
            details['debt_to_equity'] = dte
            if dte < 0.5:
                reasons.append(f"Low debt ({dte:.2f})")
                score += 0.5
            elif dte < 1.0:
                reasons.append(f"Moderate debt ({dte:.2f})")
            else:
                reasons.append(f"High debt ({dte:.2f})")
                score -= 1.0
        
        # Dividend Yield
        dy = stock_data.get('dividend_yield')
        if dy is not None and dy > 0:
            details['dividend_yield'] = dy
            if dy > 5:
                reasons.append(f"High dividend yield ({dy:.1f}%)")
                score += 1.0
            elif dy > 2:
                reasons.append(f"Decent dividend yield ({dy:.1f}%)")
                score += 0.3
        
        # Clamp score
        score = max(0, min(10, score))
        
        signal = "BUY" if score >= 6.5 else ("SELL" if score <= 3.5 else "HOLD")
        confidence = min(95, max(15, abs(score - 5) * 15 + 30))
        
        return {
            "signal": signal,
            "score": round(score, 2),
            "confidence": round(confidence, 1),
            "details": details,
            "reasons": reasons,
        }


# ============================================================================
# TECHNICAL ENGINE PLUGIN
# ============================================================================

class TechnicalEngine(BaseEnginePlugin):
    """Technical Analysis Plugin - التحليل الفني"""
    
    name = "technical"
    display_name = "Technical Engine"
    description = "تحليل فني - RSI, MACD, Bollinger Bands, Moving Averages, ADX"
    
    def __init__(self, enabled: bool = True, weight: float = 1.0):
        super().__init__(enabled, weight)
    
    def analyze(self, ticker: str, stock_data: Dict) -> Dict:
        if not self.enabled:
            return {"signal": "HOLD", "score": 0, "confidence": 0, "details": {}, "reasons": ["Engine disabled"]}
        
        score = 5.0
        reasons = []
        details = {}
        
        # RSI
        rsi = stock_data.get('rsi')
        if rsi is not None:
            details['rsi'] = rsi
            if rsi < 30:
                reasons.append(f"RSI oversold ({rsi:.1f})")
                score += 2.0
            elif rsi < 40:
                reasons.append(f"RSI approaching oversold ({rsi:.1f})")
                score += 1.0
            elif rsi < 60:
                reasons.append(f"RSI neutral ({rsi:.1f})")
            elif rsi < 70:
                reasons.append(f"RSI approaching overbought ({rsi:.1f})")
                score -= 1.0
            else:
                reasons.append(f"RSI overbought ({rsi:.1f})")
                score -= 2.0
        
        # MACD
        macd = stock_data.get('macd')
        macd_signal = stock_data.get('macd_signal_line')
        if macd is not None and macd_signal is not None:
            details['macd'] = macd
            details['macd_signal'] = macd_signal
            if macd > macd_signal:
                reasons.append("MACD bullish crossover")
                score += 1.5
            else:
                reasons.append("MACD bearish crossover")
                score -= 1.0
        
        # Moving Averages - Price vs SMA20/50
        price = stock_data.get('close', stock_data.get('price'))
        sma20 = stock_data.get('sma_20')
        sma50 = stock_data.get('sma_50')
        sma200 = stock_data.get('sma_200')
        
        if price and sma20:
            details['price_vs_sma20'] = "above" if price > sma20 else "below"
            if price > sma20:
                reasons.append(f"Price above SMA20 ({price:.2f} > {sma20:.2f})")
                score += 0.8
            else:
                reasons.append(f"Price below SMA20 ({price:.2f} < {sma20:.2f})")
                score -= 0.8
        
        if sma20 and sma50:
            details['sma20_vs_sma50'] = "golden" if sma20 > sma50 else "death"
            if sma20 > sma50:
                reasons.append("Golden cross (SMA20 > SMA50)")
                score += 1.0
            else:
                reasons.append("Death cross (SMA20 < SMA50)")
                score -= 1.0
        
        if price and sma200:
            details['price_vs_sma200'] = "above" if price > sma200 else "below"
            if price > sma200:
                reasons.append(f"Price above SMA200 (long-term bullish)")
                score += 0.5
            else:
                reasons.append(f"Price below SMA200 (long-term bearish)")
                score -= 0.5
        
        # Bollinger Bands
        bb_upper = stock_data.get('bb_upper')
        bb_lower = stock_data.get('bb_lower')
        if price and bb_upper and bb_lower:
            bb_range = bb_upper - bb_lower
            if bb_range > 0:
                bb_pos = (price - bb_lower) / bb_range
                details['bb_position'] = round(bb_pos, 2)
                if bb_pos < 0.2:
                    reasons.append("Price near lower Bollinger Band (potential bounce)")
                    score += 1.0
                elif bb_pos > 0.8:
                    reasons.append("Price near upper Bollinger Band (potential reversal)")
                    score -= 0.8
        
        # ADX
        adx = stock_data.get('adx')
        if adx is not None:
            details['adx'] = adx
            if adx > 40:
                reasons.append(f"Very strong trend (ADX={adx:.1f})")
                score += 0.5
            elif adx > 25:
                reasons.append(f"Strong trend (ADX={adx:.1f})")
            elif adx > 20:
                reasons.append(f"Moderate trend (ADX={adx:.1f})")
            else:
                reasons.append(f"Weak/no trend (ADX={adx:.1f})")
                score -= 0.5
        
        score = max(0, min(10, score))
        signal = "BUY" if score >= 6.5 else ("SELL" if score <= 3.5 else "HOLD")
        confidence = min(95, max(15, abs(score - 5) * 15 + 30))
        
        return {
            "signal": signal,
            "score": round(score, 2),
            "confidence": round(confidence, 1),
            "details": details,
            "reasons": reasons,
        }


# ============================================================================
# CANDLESTICK ENGINE PLUGIN
# ============================================================================

class CandlestickEngine(BaseEnginePlugin):
    """Candlestick Pattern Analysis Plugin - أنماط الشموع"""
    
    name = "candlestick"
    display_name = "Candlestick Engine"
    description = "تحليل أنماط الشموع - Hammer, Doji, Engulfing, Morning/Evening Star"
    
    def __init__(self, enabled: bool = True, weight: float = 1.0):
        super().__init__(enabled, weight)
    
    def analyze(self, ticker: str, stock_data: Dict) -> Dict:
        if not self.enabled:
            return {"signal": "HOLD", "score": 0, "confidence": 0, "details": {}, "reasons": ["Engine disabled"]}
        
        score = 5.0
        reasons = []
        details = {}
        
        # Get candle data
        candles = stock_data.get('candles', [])
        if not candles and all(k in stock_data for k in ['open', 'high', 'low', 'close']):
            candles = [stock_data]
        
        if not candles:
            reasons.append("No candle data available")
            return {"signal": "HOLD", "score": 5.0, "confidence": 20, "details": details, "reasons": reasons}
        
        # Use last 5 candles for pattern recognition
        recent = candles[-5:] if len(candles) >= 5 else candles
        last = recent[-1]
        
        o, h, l, c = last.get('open', 0), last.get('high', 0), last.get('low', 0), last.get('close', 0)
        body = abs(c - o)
        full_range = h - l if h > l else 0.001
        upper_shadow = h - max(c, o)
        lower_shadow = min(c, o) - l
        
        is_bullish = c > o
        is_doji = body < full_range * 0.1
        
        # Hammer (bullish reversal)
        if lower_shadow > body * 2 and upper_shadow < body * 0.5 and not is_bullish:
            reasons.append("Hammer pattern detected (bullish reversal)")
            details['pattern'] = 'hammer'
            score += 2.0
        
        # Inverted Hammer (bullish reversal)
        elif upper_shadow > body * 2 and lower_shadow < body * 0.5 and not is_bullish:
            reasons.append("Inverted Hammer pattern (potential bullish reversal)")
            details['pattern'] = 'inverted_hammer'
            score += 1.5
        
        # Shooting Star (bearish reversal)
        elif upper_shadow > body * 2 and lower_shadow < body * 0.5 and is_bullish:
            reasons.append("Shooting Star pattern (bearish reversal)")
            details['pattern'] = 'shooting_star'
            score -= 2.0
        
        # Hanging Man (bearish reversal)
        elif lower_shadow > body * 2 and upper_shadow < body * 0.5 and is_bullish:
            reasons.append("Hanging Man pattern (potential bearish reversal)")
            details['pattern'] = 'hanging_man'
            score -= 1.5
        
        # Doji (indecision)
        if is_doji:
            reasons.append("Doji pattern (indecision - trend may reverse)")
            details['pattern'] = 'doji'
            # Doji in uptrend = bearish, in downtrend = bullish
            if len(recent) >= 3:
                prev_trend_up = recent[-3].get('close', 0) < recent[-2].get('close', 0) < c
                prev_trend_down = recent[-3].get('close', 0) > recent[-2].get('close', 0) > c
                if prev_trend_up:
                    score -= 1.0
                    reasons.append("Doji after uptrend (bearish signal)")
                elif prev_trend_down:
                    score += 1.0
                    reasons.append("Doji after downtrend (bullish signal)")
        
        # Engulfing patterns (need at least 2 candles)
        if len(recent) >= 2:
            prev = recent[-2]
            prev_o, prev_c = prev.get('open', 0), prev.get('close', 0)
            prev_bullish = prev_c > prev_o
            
            # Bullish Engulfing
            if not prev_bullish and is_bullish and c > prev_o and o < prev_c:
                reasons.append("Bullish Engulfing pattern (strong buy signal)")
                details['pattern'] = 'bullish_engulfing'
                score += 2.5
            
            # Bearish Engulfing
            elif prev_bullish and not is_bullish and c < prev_o and o > prev_c:
                reasons.append("Bearish Engulfing pattern (strong sell signal)")
                details['pattern'] = 'bearish_engulfing'
                score -= 2.5
        
        # Morning/Evening Star (need 3 candles)
        if len(recent) >= 3:
            c1, c2, c3 = recent[-3], recent[-2], recent[-1]
            c1_bear = c1.get('close', 0) < c1.get('open', 0)
            c3_bull = c3.get('close', 0) > c3.get('open', 0)
            c2_body = abs(c2.get('close', 0) - c2.get('open', 0))
            c1_body = abs(c1.get('close', 0) - c1.get('open', 0))
            
            # Morning Star
            if c1_bear and c2_body < c1_body * 0.3 and c3_bull:
                reasons.append("Morning Star pattern (bullish reversal)")
                details['pattern'] = 'morning_star'
                score += 2.5
            
            # Evening Star
            elif not c1_bear and c2_body < c1_body * 0.3 and not c3_bull:
                reasons.append("Evening Star pattern (bearish reversal)")
                details['pattern'] = 'evening_star'
                score -= 2.5
        
        if not reasons:
            reasons.append("No significant candlestick pattern detected")
        
        score = max(0, min(10, score))
        signal = "BUY" if score >= 6.5 else ("SELL" if score <= 3.5 else "HOLD")
        confidence = min(90, max(15, abs(score - 5) * 12 + 25))
        
        return {
            "signal": signal,
            "score": round(score, 2),
            "confidence": round(confidence, 1),
            "details": details,
            "reasons": reasons,
        }


# ============================================================================
# MEAN REVERSION ENGINE PLUGIN
# ============================================================================

class MeanReversionEngine(BaseEnginePlugin):
    """Mean Reversion Analysis Plugin - عودة للمتوسط"""
    
    name = "mean_reversion"
    display_name = "Mean Reversion Engine"
    description = "تحليل عودة للمتوسط - Bollinger extremes, RSI extremes, distance from SMA"
    
    def __init__(self, enabled: bool = True, weight: float = 1.0):
        super().__init__(enabled, weight)
    
    def analyze(self, ticker: str, stock_data: Dict) -> Dict:
        if not self.enabled:
            return {"signal": "HOLD", "score": 0, "confidence": 0, "details": {}, "reasons": ["Engine disabled"]}
        
        score = 5.0
        reasons = []
        details = {}
        
        price = stock_data.get('close', stock_data.get('price'))
        
        # Distance from SMA20
        sma20 = stock_data.get('sma_20')
        if price and sma20 and sma20 > 0:
            distance_pct = ((price - sma20) / sma20) * 100
            details['distance_from_sma20'] = round(distance_pct, 2)
            if distance_pct < -5:
                reasons.append(f"Price {distance_pct:.1f}% below SMA20 (oversold - reversion likely)")
                score += 2.0
            elif distance_pct < -3:
                reasons.append(f"Price {distance_pct:.1f}% below SMA20 (slightly oversold)")
                score += 1.0
            elif distance_pct > 5:
                reasons.append(f"Price {distance_pct:.1f}% above SMA20 (overbought - reversion likely)")
                score -= 2.0
            elif distance_pct > 3:
                reasons.append(f"Price {distance_pct:.1f}% above SMA20 (slightly overbought)")
                score -= 1.0
            else:
                reasons.append(f"Price near SMA20 ({distance_pct:.1f}%)")
        
        # Distance from SMA50
        sma50 = stock_data.get('sma_50')
        if price and sma50 and sma50 > 0:
            distance_pct = ((price - sma50) / sma50) * 100
            details['distance_from_sma50'] = round(distance_pct, 2)
            if distance_pct < -8:
                reasons.append(f"Price {distance_pct:.1f}% below SMA50 (extreme oversold)")
                score += 2.5
            elif distance_pct > 8:
                reasons.append(f"Price {distance_pct:.1f}% above SMA50 (extreme overbought)")
                score -= 2.5
        
        # RSI extremes
        rsi = stock_data.get('rsi')
        if rsi is not None:
            details['rsi'] = rsi
            if rsi < 25:
                reasons.append(f"RSI extremely oversold ({rsi:.1f}) - strong reversion signal")
                score += 2.5
            elif rsi < 30:
                reasons.append(f"RSI oversold ({rsi:.1f}) - reversion likely")
                score += 1.5
            elif rsi > 75:
                reasons.append(f"RSI extremely overbought ({rsi:.1f}) - strong reversion signal")
                score -= 2.5
            elif rsi > 70:
                reasons.append(f"RSI overbought ({rsi:.1f}) - reversion likely")
                score -= 1.5
        
        # Bollinger Band position
        bb_upper = stock_data.get('bb_upper')
        bb_lower = stock_data.get('bb_lower')
        if price and bb_upper and bb_lower:
            bb_range = bb_upper - bb_lower
            if bb_range > 0:
                bb_pos = (price - bb_lower) / bb_range
                details['bb_position'] = round(bb_pos, 2)
                if bb_pos < 0.05:
                    reasons.append("Price touching lower Bollinger Band (extreme - reversion very likely)")
                    score += 2.0
                elif bb_pos > 0.95:
                    reasons.append("Price touching upper Bollinger Band (extreme - reversion very likely)")
                    score -= 2.0
        
        # Stochastic extremes
        stoch_k = stock_data.get('stochastic_k')
        if stoch_k is not None:
            details['stochastic_k'] = stoch_k
            if stoch_k < 20:
                reasons.append(f"Stochastic oversold ({stoch_k:.1f})")
                score += 1.0
            elif stoch_k > 80:
                reasons.append(f"Stochastic overbought ({stoch_k:.1f})")
                score -= 1.0
        
        if not reasons:
            reasons.append("Price near mean - no reversion signal")
        
        score = max(0, min(10, score))
        signal = "BUY" if score >= 6.5 else ("SELL" if score <= 3.5 else "HOLD")
        confidence = min(90, max(15, abs(score - 5) * 12 + 25))
        
        return {
            "signal": signal,
            "score": round(score, 2),
            "confidence": round(confidence, 1),
            "details": details,
            "reasons": reasons,
        }


# ============================================================================
# PIPELINE CONFIGURATION
# ============================================================================

@dataclass
class EngineConfig:
    """Configuration for a single engine in a pipeline."""
    name: str
    enabled: bool = True
    weight: float = 1.0


@dataclass
class PipelineConfig:
    """Configuration for an analysis pipeline."""
    name: str
    display_name: str
    description: str
    engines: Dict[str, EngineConfig] = field(default_factory=dict)
    
    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "engines": {k: asdict(v) for k, v in self.engines.items()},
        }


# ============================================================================
# PRESET DEFINITIONS
# ============================================================================

PRESETS = {
    "egx_conservative": PipelineConfig(
        name="egx_conservative",
        display_name="EGX Conservative",
        description="للمستثمر - تحليل أساسي قوي، فني معتدل، إدارة مخاطر عالية",
        engines={
            "fundamental": EngineConfig(name="fundamental", enabled=True, weight=2.0),
            "technical": EngineConfig(name="technical", enabled=True, weight=1.0),
            "candlestick": EngineConfig(name="candlestick", enabled=True, weight=0.5),
            "mean_reversion": EngineConfig(name="mean_reversion", enabled=True, weight=0.5),
        }
    ),
    "egx_aggressive": PipelineConfig(
        name="egx_aggressive",
        display_name="EGX Aggressive",
        description="للمضارب - تحليل فني قوي، شموع، عودة للمتوسط",
        engines={
            "fundamental": EngineConfig(name="fundamental", enabled=True, weight=0.5),
            "technical": EngineConfig(name="technical", enabled=True, weight=2.0),
            "candlestick": EngineConfig(name="candlestick", enabled=True, weight=1.5),
            "mean_reversion": EngineConfig(name="mean_reversion", enabled=True, weight=1.0),
        }
    ),
    "egx_balanced": PipelineConfig(
        name="egx_balanced",
        display_name="EGX Balanced",
        description="مزيج - توازن بين الأساسي والفني",
        engines={
            "fundamental": EngineConfig(name="fundamental", enabled=True, weight=1.0),
            "technical": EngineConfig(name="technical", enabled=True, weight=1.0),
            "candlestick": EngineConfig(name="candlestick", enabled=True, weight=1.0),
            "mean_reversion": EngineConfig(name="mean_reversion", enabled=True, weight=1.0),
        }
    ),
    "crypto_scalp": PipelineConfig(
        name="crypto_scalp",
        display_name="Crypto Scalp",
        description="للكريبتو - فني سريع، شموع، عودة للمتوسط",
        engines={
            "fundamental": EngineConfig(name="fundamental", enabled=False, weight=0.0),
            "technical": EngineConfig(name="technical", enabled=True, weight=2.0),
            "candlestick": EngineConfig(name="candlestick", enabled=True, weight=2.0),
            "mean_reversion": EngineConfig(name="mean_reversion", enabled=True, weight=1.5),
        }
    ),
}


# ============================================================================
# ANALYSIS ORCHESTRATOR
# ============================================================================

class AnalysisOrchestrator:
    """
    المحرك المركزي - يحسب النتيجة النهائية بناءً على المحركات المفعلة
    
    كل محرك يرجع score + signal + confidence
    النتيجة النهائية = weighted average of all enabled engines
    """
    
    ENGINE_MAP = {
        "fundamental": FundamentalEngine,
        "technical": TechnicalEngine,
        "candlestick": CandlestickEngine,
        "mean_reversion": MeanReversionEngine,
    }
    
    def __init__(self):
        self.pipelines: Dict[str, PipelineConfig] = {}
        self.engine_instances: Dict[str, Dict[str, BaseEnginePlugin]] = {}
        self.custom_presets: Dict[str, PipelineConfig] = {}
        
        # Initialize default presets
        for preset_name, preset_config in PRESETS.items():
            self.pipelines[preset_name] = preset_config
            self._create_engine_instances(preset_name, preset_config)
        
        # Load custom presets from file
        self._load_custom_presets()
    
    def _create_engine_instances(self, pipeline_name: str, config: PipelineConfig):
        """Create engine instances for a pipeline."""
        self.engine_instances[pipeline_name] = {}
        for eng_name, eng_config in config.engines.items():
            engine_class = self.ENGINE_MAP.get(eng_name)
            if engine_class:
                instance = engine_class(
                    enabled=eng_config.enabled,
                    weight=eng_config.weight
                )
                self.engine_instances[pipeline_name][eng_name] = instance
    
    def _load_custom_presets(self):
        """Load custom presets from JSON file."""
        preset_file = Path(__file__).parent / 'data' / 'custom_presets.json'
        if preset_file.exists():
            try:
                with open(preset_file, 'r') as f:
                    data = json.load(f)
                for preset_data in data.get('presets', []):
                    config = PipelineConfig(
                        name=preset_data['name'],
                        display_name=preset_data['display_name'],
                        description=preset_data['description'],
                    )
                    for eng_name, eng_data in preset_data.get('engines', {}).items():
                        config.engines[eng_name] = EngineConfig(
                            name=eng_name,
                            enabled=eng_data.get('enabled', True),
                            weight=eng_data.get('weight', 1.0),
                        )
                    self.custom_presets[config.name] = config
                    self.pipelines[config.name] = config
                    self._create_engine_instances(config.name, config)
            except Exception as e:
                print(f"[AnalysisOrchestrator] Error loading custom presets: {e}")
    
    def _save_custom_presets(self):
        """Save custom presets to JSON file."""
        preset_file = Path(__file__).parent / 'data' / 'custom_presets.json'
        preset_file.parent.mkdir(parents=True, exist_ok=True)
        
        presets_data = []
        for name, config in self.custom_presets.items():
            presets_data.append(config.to_dict())
        
        try:
            with open(preset_file, 'w') as f:
                json.dump({"presets": presets_data}, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[AnalysisOrchestrator] Error saving custom presets: {e}")
    
    def analyze(self, ticker: str, pipeline_name: str = "egx_balanced", stock_data: Dict = None) -> Dict:
        """
        Run analysis on a ticker using the specified pipeline.
        
        Returns:
            {
                "signal": "BUY" | "SELL" | "HOLD",
                "score": float (0-10),
                "confidence": float (0-100),
                "engines": [...],
                "pipeline": str,
                "ticker": str,
                "timestamp": str,
            }
        """
        if stock_data is None:
            stock_data = {}
        
        pipeline = self.pipelines.get(pipeline_name)
        if not pipeline:
            return {
                "signal": "HOLD",
                "score": 0,
                "confidence": 0,
                "engines": [],
                "pipeline": pipeline_name,
                "ticker": ticker,
                "error": f"Pipeline '{pipeline_name}' not found",
                "timestamp": datetime.now().isoformat(),
            }
        
        engine_instances = self.engine_instances.get(pipeline_name, {})
        
        # Run each enabled engine
        engine_results = []
        total_weighted_score = 0
        total_weight = 0
        signal_counts = {"BUY": 0, "SELL": 0, "HOLD": 0}
        
        for eng_name, eng_config in pipeline.engines.items():
            instance = engine_instances.get(eng_name)
            if not instance or not eng_config.enabled:
                engine_results.append({
                    "name": eng_name,
                    "enabled": False,
                    "signal": "HOLD",
                    "score": 0,
                    "confidence": 0,
                    "weight": eng_config.weight,
                })
                continue
            
            try:
                result = instance.analyze(ticker, stock_data)
                weighted_score = result['score'] * eng_config.weight
                total_weighted_score += weighted_score
                total_weight += eng_config.weight
                signal_counts[result['signal']] += 1
                
                engine_results.append({
                    "name": eng_name,
                    "enabled": True,
                    "signal": result['signal'],
                    "score": result['score'],
                    "confidence": result['confidence'],
                    "weight": eng_config.weight,
                    "weighted_score": round(weighted_score, 2),
                    "details": result.get('details', {}),
                    "reasons": result.get('reasons', []),
                })
            except Exception as e:
                engine_results.append({
                    "name": eng_name,
                    "enabled": True,
                    "error": str(e),
                    "signal": "HOLD",
                    "score": 0,
                    "confidence": 0,
                    "weight": eng_config.weight,
                })
        
        # Calculate final score
        final_score = total_weighted_score / total_weight if total_weight > 0 else 5.0
        final_score = max(0, min(10, round(final_score, 2)))
        
        # Determine final signal
        if final_score >= 6.5:
            final_signal = "BUY"
        elif final_score <= 3.5:
            final_signal = "SELL"
        else:
            final_signal = "HOLD"
        
        # Calculate confidence based on engine agreement
        total_engines = sum(1 for e in engine_results if e.get('enabled'))
        agree_count = signal_counts.get(final_signal, 0)
        agreement_pct = (agree_count / total_engines * 100) if total_engines > 0 else 0
        confidence = min(95, max(20, agreement_pct * 0.6 + abs(final_score - 5) * 5 + 20))
        
        return {
            "signal": final_signal,
            "score": final_score,
            "confidence": round(confidence, 1),
            "engines": engine_results,
            "pipeline": pipeline_name,
            "pipeline_display_name": pipeline.display_name,
            "ticker": ticker,
            "timestamp": datetime.now().isoformat(),
            "signal_counts": signal_counts,
        }
    
    def toggle_engine(self, pipeline_name: str, engine_name: str, enabled: bool) -> Dict:
        """Toggle an engine on/off in a pipeline."""
        pipeline = self.pipelines.get(pipeline_name)
        if not pipeline:
            return {"success": False, "error": f"Pipeline '{pipeline_name}' not found"}
        
        if engine_name not in pipeline.engines:
            return {"success": False, "error": f"Engine '{engine_name}' not found in pipeline"}
        
        pipeline.engines[engine_name].enabled = enabled
        
        # Update instance
        instances = self.engine_instances.get(pipeline_name, {})
        if engine_name in instances:
            instances[engine_name].enabled = enabled
        
        return {"success": True, "pipeline": pipeline_name, "engine": engine_name, "enabled": enabled}
    
    def set_engine_weight(self, pipeline_name: str, engine_name: str, weight: float) -> Dict:
        """Set the weight of an engine in a pipeline."""
        pipeline = self.pipelines.get(pipeline_name)
        if not pipeline:
            return {"success": False, "error": f"Pipeline '{pipeline_name}' not found"}
        
        if engine_name not in pipeline.engines:
            return {"success": False, "error": f"Engine '{engine_name}' not found in pipeline"}
        
        weight = max(0, min(5.0, weight))  # Clamp weight
        pipeline.engines[engine_name].weight = weight
        
        # Update instance
        instances = self.engine_instances.get(pipeline_name, {})
        if engine_name in instances:
            instances[engine_name].weight = weight
        
        return {"success": True, "pipeline": pipeline_name, "engine": engine_name, "weight": weight}
    
    def get_pipeline_summary(self, pipeline_name: str) -> Dict:
        """Get summary of a pipeline configuration."""
        pipeline = self.pipelines.get(pipeline_name)
        if not pipeline:
            return {"success": False, "error": f"Pipeline '{pipeline_name}' not found"}
        
        return {
            "success": True,
            "pipeline": pipeline.to_dict(),
        }
    
    def list_pipelines(self) -> List[Dict]:
        """List all available pipelines."""
        result = []
        for name, config in self.pipelines.items():
            result.append({
                "name": name,
                "display_name": config.display_name,
                "description": config.description,
                "is_custom": name in self.custom_presets,
                "engines": {k: {"enabled": v.enabled, "weight": v.weight} for k, v in config.engines.items()},
            })
        return result
    
    def save_preset(self, pipeline_name: str, preset_name: str) -> Dict:
        """Save current pipeline state as a new preset."""
        pipeline = self.pipelines.get(pipeline_name)
        if not pipeline:
            return {"success": False, "error": f"Pipeline '{pipeline_name}' not found"}
        
        # Create new config from current pipeline
        new_config = PipelineConfig(
            name=preset_name.lower().replace(' ', '_'),
            display_name=preset_name,
            description=f"Custom preset based on {pipeline.display_name}",
        )
        for eng_name, eng_config in pipeline.engines.items():
            new_config.engines[eng_name] = EngineConfig(
                name=eng_name,
                enabled=eng_config.enabled,
                weight=eng_config.weight,
            )
        
        # Add to custom presets
        self.custom_presets[new_config.name] = new_config
        self.pipelines[new_config.name] = new_config
        self._create_engine_instances(new_config.name, new_config)
        self._save_custom_presets()
        
        return {"success": True, "preset_name": new_config.name, "message": f"Preset '{preset_name}' saved"}
    
    def load_preset(self, preset_name: str) -> Dict:
        """Load a preset configuration."""
        config = self.pipelines.get(preset_name)
        if not config:
            return {"success": False, "error": f"Preset '{preset_name}' not found"}
        
        return {
            "success": True,
            "preset": config.to_dict(),
        }


# ============================================================================
# GLOBAL INSTANCE
# ============================================================================

# Singleton instance
_orchestrator = None

def get_orchestrator() -> AnalysisOrchestrator:
    """Get the global AnalysisOrchestrator instance."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = AnalysisOrchestrator()
    return _orchestrator

#!/usr/bin/env python3
"""
REGIME-AWARE ORCHESTRATOR v2
================================
Phase 4: تطوير المنسّق بمصفوفة الحالات + الأوزان

Determines:
1. Market regime (R1-R11)
2. Stock regime (S1-S14)  
3. Regime context (combined + confidence)
4. Engine selection per context
5. Weight matrix per regime
6. Execution order
7. NO_TRADE conditions
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from datetime import datetime
import uuid

# Engine families (from actual inventory)
ENGINE_FAMILIES = {
    'trend': ['technical', 'technical_weighted', 'technical_target_engine', 'multi_timeframe_engine'],
    'momentum': ['breakout_signal', 'sniper_engine'],
    'range': ['candlestick', 'candle_probability_engine', 'fibonacci', 'support_resistance_calculator'],
    'volume': ['liquidity_filter', 'volume_profile'],
    'risk': ['risk', 'risk_adaptive', 'position_sizing', 'news_stop_filter'],
    'fundamental': ['fundamental', 'fundamental_engine', 'fundamental_scorer'],
    'news': ['news_fetcher_analyzer', 'news_impact_scorer', 'sentiment_analyzer'],
    'confluence': ['confluence_engine_v3', 'conviction_engine', 'confidence_engine'],
    'pattern': ['smc_engine', 'ai_pattern_analyzer'],
    'regime': ['market_regime_engine'],
}

# Weight policies
POLICIES = {
    'A': {  # Baseline: fixed weights
        'trend': 0.20, 'momentum': 0.15, 'range': 0.10, 'volume': 0.15,
        'risk': 0.20, 'fundamental': 0.10, 'news': 0.05, 'confluence': 0.05,
        'pattern': 0.00, 'regime': 0.00,
    },
    'B_R1': {  # Bull stable
        'trend': 0.25, 'momentum': 0.20, 'range': 0.05, 'volume': 0.10,
        'risk': 0.15, 'fundamental': 0.10, 'news': 0.05, 'confluence': 0.05,
        'pattern': 0.05, 'regime': 0.00,
    },
    'B_R3': {  # Bear stable
        'trend': 0.20, 'momentum': 0.10, 'range': 0.05, 'volume': 0.10,
        'risk': 0.35, 'fundamental': 0.05, 'news': 0.05, 'confluence': 0.05,
        'pattern': 0.05, 'regime': 0.00,
    },
    'B_R4': {  # Bear accelerating
        'trend': 0.05, 'momentum': 0.05, 'range': 0.00, 'volume': 0.05,
        'risk': 0.50, 'fundamental': 0.05, 'news': 0.05, 'confluence': 0.05,
        'pattern': 0.10, 'regime': 0.10,
    },
    'B_R5': {  # Sideways
        'trend': 0.05, 'momentum': 0.10, 'range': 0.25, 'volume': 0.15,
        'risk': 0.20, 'fundamental': 0.05, 'news': 0.05, 'confluence': 0.10,
        'pattern': 0.05, 'regime': 0.00,
    },
    'B_R6': {  # Bullish breakout
        'trend': 0.10, 'momentum': 0.15, 'range': 0.00, 'volume': 0.20,
        'risk': 0.15, 'fundamental': 0.05, 'news': 0.05, 'confluence': 0.10,
        'pattern': 0.20, 'regime': 0.00,
    },
    'B_R8': {  # High volatility
        'trend': 0.05, 'momentum': 0.05, 'range': 0.05, 'volume': 0.10,
        'risk': 0.45, 'fundamental': 0.05, 'news': 0.05, 'confluence': 0.05,
        'pattern': 0.10, 'regime': 0.05,
    },
    'UNKNOWN': {  # Safe default
        'trend': 0.20, 'momentum': 0.10, 'range': 0.10, 'volume': 0.15,
        'risk': 0.25, 'fundamental': 0.05, 'news': 0.05, 'confluence': 0.10,
        'pattern': 0.00, 'regime': 0.00,
    },
}


@dataclass
class RegimeContext:
    """نتيجة تحليل حالة السوق + السهم."""
    market_regime: str = 'UNKNOWN'
    stock_regime: str = 'UNKNOWN'
    confidence: str = 'LOW'  # HIGH | MEDIUM | LOW
    data_quality: str = 'fresh'
    regime_label: str = 'UNKNOWN'
    no_trade_reason: str = ''


@dataclass
class RegimePlan:
    """خطة منسّق مبنية على الحالة."""
    plan_id: str = ''
    ticker: str = ''
    market: str = 'EGX'
    regime_context: RegimeContext = field(default_factory=RegimeContext)
    selected_engines: List[str] = field(default_factory=list)
    skipped_engines: List[Dict] = field(default_factory=list)
    engine_weights: Dict[str, float] = field(default_factory=dict)
    execution_order: List[str] = field(default_factory=list)
    policy: str = 'A'
    decision_policy: str = 'full'  # full | partial | no_trade
    config_version: str = 'v2.0'
    created_at: str = ''
    
    def __post_init__(self):
        if not self.plan_id:
            self.plan_id = str(uuid.uuid4())
        if not self.created_at:
            self.created_at = datetime.now().isoformat()


def detect_market_regime(prices: List[float], volumes: List[float] = None) -> str:
    """يحدد حالة السوق من الأسعار."""
    if not prices or len(prices) < 20:
        return 'R11'  # insufficient data
    
    change_5d = (prices[-1] - prices[-5]) / prices[-5] * 100 if len(prices) >= 5 else 0
    change_20d = (prices[-1] - prices[-20]) / prices[-20] * 100 if len(prices) >= 20 else 0
    
    # Simple RSI-like momentum
    gains = [max(0, prices[i] - prices[i-1]) for i in range(1, min(len(prices), 15))]
    losses = [max(0, prices[i-1] - prices[i]) for i in range(1, min(len(prices), 15))]
    avg_gain = sum(gains) / len(gains) if gains else 0
    avg_loss = sum(losses) / len(losses) if losses else 1
    
    # ATR-like volatility
    if len(prices) >= 15:
        recent_ranges = [abs(prices[i] - prices[i-1]) / prices[i-1] for i in range(-14, 0)]
        volatility = sum(recent_ranges) / len(recent_ranges) * 100
    else:
        volatility = 0
    
    # Classification
    if change_5d > 2 and change_20d > 3:
        return 'R1'  # bull stable
    elif change_5d > 0 and change_20d > 0 and avg_gain > avg_loss * 0.8:
        return 'R2'  # bull weakening
    elif change_5d < -2 and change_20d < -3:
        if change_5d < -5:
            return 'R4'  # bear accelerating
        return 'R3'  # bear stable
    elif abs(change_5d) < 1 and abs(change_20d) < 2:
        return 'R5'  # sideways
    elif volatility > 3:
        return 'R8'  # high volatility
    else:
        return 'R10'  # conflicting


def detect_stock_regime(prices: List[float]) -> str:
    """يحدد حالة السهم."""
    if not prices or len(prices) < 20:
        return 'S14'  # insufficient
    
    change_5d = (prices[-1] - prices[-5]) / prices[-5] * 100 if len(prices) >= 5 else 0
    change_20d = (prices[-1] - prices[-20]) / prices[-20] * 100 if len(prices) >= 20 else 0
    
    sma20 = sum(prices[-20:]) / 20 if len(prices) >= 20 else prices[-1]
    
    if prices[-1] > sma20 * 1.02 and change_5d > 2:
        return 'S1'  # strong uptrend
    elif prices[-1] > sma20 and change_5d > 0:
        return 'S2'  # uptrend weakening
    elif prices[-1] < sma20 * 0.98 and change_5d < -2:
        return 'S3'  # downtrend
    elif abs(prices[-1] - sma20) / sma20 < 0.02:
        return 'S4'  # sideways/range
    elif change_5d > 3 and prices[-1] > sma20:
        return 'S5'  # breakout potential
    elif prices[-1] < sma20 and change_5d > 0:
        return 'S6'  # bounce from support
    else:
        return 'S13'  # conflicting


def create_regime_plan(ticker: str, prices: List[float], volumes: List[float] = None,
                       market: str = 'EGX', policy: str = 'D') -> RegimePlan:
    """ينشئ خطة مبنية على حالة السوق + السهم."""
    
    # Step 1-2: Detect regimes
    market_regime = detect_market_regime(prices, volumes)
    stock_regime = detect_stock_regime(prices)
    
    # Step 3: Regime context
    no_trade_reasons = []
    
    # NO_TRADE conditions
    if market_regime in ('R9', 'R11'):  # liquidity critical / insufficient data
        no_trade_reasons.append(f'Market regime {market_regime}')
    if market_regime == 'R4':  # bear accelerating
        no_trade_reasons.append('Bear accelerating — high risk')
    if stock_regime in ('S11', 'S14'):  # illiquid / insufficient
        no_trade_reasons.append(f'Stock regime {stock_regime}')
    if market_regime == 'R8':  # high volatility
        no_trade_reasons.append('High volatility — risk exceeds limits')
    
    confidence = 'MEDIUM'
    if market_regime == 'R10' or stock_regime == 'S13':
        confidence = 'LOW'
        no_trade_reasons.append('Conflicting signals')
    elif market_regime in ('R1', 'R3', 'R5') and stock_regime in ('S1', 'S3', 'S4'):
        confidence = 'HIGH'
    
    context = RegimeContext(
        market_regime=market_regime,
        stock_regime=stock_regime,
        confidence=confidence,
        regime_label=f'{market_regime}+{stock_regime}',
    )
    
    # NO_TRADE?
    if no_trade_reasons:
        context.no_trade_reason = '; '.join(no_trade_reasons)
        return RegimePlan(
            ticker=ticker, market=market, regime_context=context,
            selected_engines=[], decision_policy='no_trade',
            policy=policy,
        )
    
    # Step 4: Select engines + weights
    weight_key = f'B_{market_regime}' if policy in ('B', 'D') and f'B_{market_regime}' in POLICIES else 'UNKNOWN'
    if policy == 'A':
        weights = POLICIES['A']
    else:
        weights = POLICIES.get(weight_key, POLICIES['UNKNOWN'])
    
    # Select engines from families with weight > 0
    selected = []
    skipped = []
    for family, weight in weights.items():
        if weight > 0 and family in ENGINE_FAMILIES:
            # Pick first engine from family (simplified)
            for eng in ENGINE_FAMILIES[family]:
                selected.append(eng)
        elif weight == 0:
            for eng in ENGINE_FAMILIES.get(family, []):
                skipped.append({'name': eng, 'reason': f'{family} weight=0 for {market_regime}'})
    
    # Execution order
    order = ['regime', 'volume', 'trend', 'momentum', 'range', 'pattern',
             'fundamental', 'news', 'confluence', 'risk']
    ordered = [e for o in order for e in selected if e in ENGINE_FAMILIES.get(o, [])]
    
    return RegimePlan(
        ticker=ticker, market=market, regime_context=context,
        selected_engines=ordered,
        skipped_engines=skipped,
        engine_weights=weights,
        execution_order=order,
        policy=policy,
        decision_policy='full' if confidence == 'HIGH' else 'partial',
    )

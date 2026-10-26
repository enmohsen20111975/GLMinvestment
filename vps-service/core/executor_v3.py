"""
executor_v3.py — المنفّذ المطور: يطبّق الأوزان فعليًا
=====================================================
يستقبل خطة من orchestrator_v3، يشغّل المحركات،
يطبّق الأوزان V1 على مخرجات منفصلة، يدمج النتائج.

الفرق عن executor.py القديم:
- يطبّق الأوزان على درجات المحركات المنفصلة
- يدمج flow_system + master_analyzer كمصدرين مستقلين
- يحسب Signal Score موزون + Confidence منفصل
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from datetime import datetime
import uuid, sys, os, logging

logger = logging.getLogger(__name__)

@dataclass
class V3Result:
    """نتيجة تنفيذ خطة V3."""
    execution_id: str = ""
    plan_id: str = ""
    started_at: str = ""
    completed_at: str = ""
    
    # Engine outputs (normalized -100 to +100)
    engine_scores: Dict[str, float] = field(default_factory=dict)  # family → normalized score
    engine_signals: Dict[str, str] = field(default_factory=dict)   # family → signal direction
    
    # Weighted combination
    signal_score: float = 0.0       # weighted average (-100 to +100)
    confidence: float = 50.0       # 0-100
    
    # Final decision
    final_signal: str = "NO_TRADE"
    risk_profile: Dict = field(default_factory=dict)
    position_size_pct: float = 5.0
    
    # Audit
    failed_engines: List[Dict] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=dict)
    complete: bool = False
    no_trade_reason: str = ""
    code_version: str = ""
    
    def __post_init__(self):
        if not self.execution_id:
            self.execution_id = str(uuid.uuid4())
        if not self.started_at:
            self.started_at = datetime.now().isoformat()


def execute_v3(plan, prices=None, volumes=None, ticker=None, market='EGX'):
    """ينفذ خطة V3 مع تطبيق الأوزان فعليًا."""
    result = V3Result(
        plan_id=plan.plan_id,
        code_version=os.environ.get('GIT_COMMIT', 'unknown'),
    )
    
    if plan.decision_policy == 'no_trade':
        result.final_signal = 'NO_TRADE'
        result.no_trade_reason = plan.no_trade_reason
        result.completed_at = datetime.now().isoformat()
        return result
    
    # Run engines per family and normalize scores
    family_scores = {}
    family_signals = {}
    
    for family, weight in plan.normalized_weights.items():
        if weight <= 0:
            continue
        
        try:
            score, signal = _run_family_engine(family, plan, prices, volumes, ticker, market)
            if score is not None:
                family_scores[family] = score
                family_signals[family] = signal
            else:
                result.failed_engines.append({'family': family, 'error': 'returned None'})
        except Exception as e:
            result.failed_engines.append({'family': family, 'error': str(e)})
            result.warnings.append(f'{family} failed: {e}')
    
    result.engine_scores = family_scores
    result.engine_signals = family_signals
    
    # Check minimum evidence coverage
    if len(family_scores) < 3:
        result.final_signal = 'NO_TRADE'
        result.no_trade_reason = f'insufficient evidence: only {len(family_scores)} families'
        result.completed_at = datetime.now().isoformat()
        return result
    
    # Calculate weighted Signal Score
    weights = plan.normalized_weights
    total_weight = sum(weights.get(f, 0) for f in family_scores)
    if total_weight == 0:
        result.final_signal = 'NO_TRADE'
        result.no_trade_reason = 'zero total weight'
        result.completed_at = datetime.now().isoformat()
        return result
    
    signal_score = sum(family_scores[f] * weights.get(f, 0) for f in family_scores) / total_weight
    result.signal_score = round(signal_score, 2)
    
    # Calculate Confidence (agreement between engines)
    positive = sum(1 for s in family_scores.values() if s > 20)
    negative = sum(1 for s in family_scores.values() if s < -20)
    neutral = len(family_scores) - positive - negative
    
    if positive > 0 and negative > 0:
        # Conflict reduces confidence
        agreement = max(positive, negative) / len(family_scores)
        result.confidence = round(agreement * 60, 1)  # max 60% if conflict
    elif positive > 0:
        result.confidence = round(min(positive / len(family_scores) * 100, 90), 1)
    elif negative > 0:
        result.confidence = round(min(negative / len(family_scores) * 100, 90), 1)
    else:
        result.confidence = 30.0  # all neutral → low confidence
    
    # Conflict check
    from core.orchestrator_v3 import resolve_conflict
    ok, conflict_reason = resolve_conflict(family_scores)
    if not ok:
        result.warnings.append(f'Conflict: {conflict_reason}')
        result.confidence = min(result.confidence, 40)
    
    result.complete = True
    result.completed_at = datetime.now().isoformat()
    return result


def _run_family_engine(family, plan, prices, volumes, ticker, market):
    """يشغّل محرك من عائلة معينة ويرجع (normalized_score, signal)."""
    
    if family == 'TREND':
        return _run_trend(plan, prices, volumes, ticker, market)
    elif family == 'MOM':
        return _run_momentum(plan, prices, volumes, ticker, market)
    elif family == 'MR':
        return _run_mean_reversion(plan, prices, volumes, ticker, market)
    elif family == 'BRK':
        return _run_breakout(plan, prices, volumes, ticker, market)
    elif family == 'FLOW':
        return _run_flow(plan, prices, volumes, ticker, market)
    elif family == 'FUND':
        return _run_fundamental(plan, ticker, market)
    elif family == 'EVENT':
        return _run_event(plan, ticker, market)
    else:
        return None, None


def _run_trend(plan, prices, volumes, ticker, market):
    """TREND family — uses master_analyzer's technical output."""
    if not prices or len(prices) < 50:
        return None, None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from analyzers.master_analyzer import MasterAnalyzer
        a = MasterAnalyzer()
        r = a.analyze(ticker or plan.ticker, prices=prices, volumes=volumes or [])
        if not r:
            return None, None
        score = getattr(r, 'master_score', 50)
        signal = getattr(r, 'signal', 'HOLD')
        # Normalize to -100..+100 (master_score is 0-100, neutral=50)
        norm = (score - 50) * 2
        return norm, signal
    except Exception as e:
        logger.warning(f'TREND engine failed: {e}')
        raise


def _run_momentum(plan, prices, volumes, ticker, market):
    """MOM family — RSI-based momentum."""
    if not prices or len(prices) < 20:
        return None, None
    # Simple RSI(14)
    gains = [max(0, prices[i] - prices[i-1]) for i in range(1, min(len(prices), 15))]
    losses = [max(0, prices[i-1] - prices[i]) for i in range(1, min(len(prices), 15))]
    avg_gain = sum(gains) / len(gains) if gains else 0
    avg_loss = sum(losses) / len(losses) if losses else 1
    rsi = 100 - (100 / (1 + avg_gain / avg_loss)) if avg_loss > 0 else 100
    # Normalize: RSI=50 → 0, RSI=70 → +40, RSI=30 → -40
    norm = (rsi - 50) * 2
    signal = 'BUY' if rsi > 60 else 'SELL' if rsi < 40 else 'HOLD'
    return norm, signal


def _run_mean_reversion(plan, prices, volumes, ticker, market):
    """MR family — price vs SMA20."""
    if not prices or len(prices) < 20:
        return None, None
    sma20 = sum(prices[-20:]) / 20
    last = prices[-1]
    # If price below SMA → mean reversion buy signal
    deviation = (last - sma20) / sma20 * 100
    # Normalize: price 5% below SMA → +40, price 5% above → -40
    norm = max(-80, min(80, -deviation * 8))
    signal = 'BUY' if deviation < -2 else 'SELL' if deviation > 2 else 'HOLD'
    return norm, signal


def _run_breakout(plan, prices, volumes, ticker, market):
    """BRK family — price vs 20-day high/low."""
    if not prices or len(prices) < 20:
        return None, None
    high_20 = max(prices[-20:])
    low_20 = min(prices[-20:])
    last = prices[-1]
    range_pct = (high_20 - low_20) / low_20 * 100 if low_20 > 0 else 0
    
    if last >= high_20 * 0.98:
        norm = 50  # near breakout
        signal = 'BUY'
    elif last <= low_20 * 1.02:
        norm = -50  # near breakdown
        signal = 'SELL'
    else:
        # Position within range
        pos = (last - low_20) / (high_20 - low_20) if high_20 > low_20 else 0.5
        norm = (pos - 0.5) * 40
        signal = 'HOLD'
    return norm, signal


def _run_flow(plan, prices, volumes, ticker, market):
    """FLOW family — volume analysis."""
    if not volumes or len(volumes) < 20:
        return None, None
    avg_vol_20 = sum(volumes[-20:]) / 20
    recent_vol = sum(volumes[-5:]) / 5
    vol_ratio = recent_vol / avg_vol_20 if avg_vol_20 > 0 else 1
    
    # High volume = confirmation (positive), but only if price is up
    if prices and len(prices) >= 2:
        price_change = (prices[-1] - prices[-5]) / prices[-5] * 100 if len(prices) >= 5 else 0
        if vol_ratio > 1.5 and price_change > 0:
            norm = min(80, vol_ratio * 20)
            signal = 'BUY'
        elif vol_ratio > 1.5 and price_change < 0:
            norm = min(-40, -vol_ratio * 15)
            signal = 'SELL'
        else:
            norm = 0
            signal = 'HOLD'
    else:
        norm = 0
        signal = 'HOLD'
    return norm, signal


def _run_fundamental(plan, ticker, market):
    """FUND family — placeholder (needs fundamental data)."""
    # Without fundamental data, return neutral
    return 0, 'HOLD'


def _run_event(plan, ticker, market):
    """EVENT family — placeholder (needs news data)."""
    return 0, 'HOLD'

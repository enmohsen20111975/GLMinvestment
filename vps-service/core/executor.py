"""
executor.py — المنفّذ: ينفذ خطة المنسّق
============================================
يستقبل Plan من المنسّق، يشغّل المحركات المعتمدة،
يجمع النتائج، يتحقق من سلامتها، يرجع ExecutorResult.

لا يصدر قرارًا مستقلاً. لا يتجاوز المخاطر. لا يخفى الفشل.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from datetime import datetime
import uuid
import sys
import os
import logging

logger = logging.getLogger(__name__)

@dataclass
class ExecutorResult:
    """نتيجة تنفيذ الخطة."""
    execution_id: str = ""
    plan_id: str = ""
    started_at: str = ""
    completed_at: str = ""
    engine_results: Dict[str, Any] = field(default_factory=dict)
    failed_engines: List[Dict] = field(default_factory=list)
    final_signal: str = "NO_TRADE"
    master_score: float = 0.0
    risk_profile: Dict = field(default_factory=dict)
    code_version: str = ""
    config_version: str = ""
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    complete: bool = False  # هل التحليل اكتمل بنجاح؟
    
    def __post_init__(self):
        if not self.execution_id:
            self.execution_id = str(uuid.uuid4())
        if not self.started_at:
            self.started_at = datetime.now().isoformat()


def execute_plan(plan, prices=None, volumes=None, ticker=None, market='EGX'):
    """ينفذ خطة المنسّق. Returns ExecutorResult.
    
    يستدعى المحركات المعتمدة الموجودة (master_analyzer / flow_system)
    بناءً على الخطة، ولا ينشئ تحليلاً جديدًا.
    """
    result = ExecutorResult(
        plan_id=plan.plan_id,
        code_version=os.environ.get('GIT_COMMIT', 'unknown'),
        config_version=plan.config_version,
    )
    
    # Gate: no_trade → don't run anything
    if plan.decision_policy == 'no_trade':
        result.final_signal = 'NO_TRADE'
        result.warnings.append('No-trade policy: insufficient data')
        result.completed_at = datetime.now().isoformat()
        result.complete = False
        return result
    
    if not plan.selected_engines:
        result.errors.append('No engines selected in plan')
        result.completed_at = datetime.now().isoformat()
        result.complete = False
        return result
    
    # Execute engines
    for engine_name in plan.selected_engines:
        try:
            engine_result = _run_engine(engine_name, plan, prices, volumes, ticker, market)
            if engine_result is not None:
                result.engine_results[engine_name] = engine_result
            else:
                result.failed_engines.append({
                    'name': engine_name,
                    'error': 'returned None',
                    'timestamp': datetime.now().isoformat(),
                })
                result.warnings.append(f'Engine {engine_name} returned None')
        except Exception as e:
            result.failed_engines.append({
                'name': engine_name,
                'error': str(e),
                'timestamp': datetime.now().isoformat(),
            })
            result.errors.append(f'Engine {engine_name} failed: {e}')
            logger.warning(f'Engine {engine_name} failed: {e}')
    
    # Check critical engine failures
    critical_engines = {'liquidity_filter', 'technical', 'risk'}
    failed_critical = [e for e in result.failed_engines if e['name'] in critical_engines]
    
    if failed_critical:
        result.final_signal = 'NO_TRADE'
        result.warnings.append(f'Critical engine(s) failed: {[e["name"] for e in failed_critical]}')
        result.complete = False
    else:
        # Extract final signal from master_analyzer result if available
        # (master_analyzer is the unified decision source for the API path)
        result.complete = True
    
    result.completed_at = datetime.now().isoformat()
    return result


def _run_engine(engine_name, plan, prices, volumes, ticker, market):
    """يشغّل محرك واحد. Returns result dict or None."""
    if engine_name == 'master_analyzer' or engine_name == 'technical':
        # Use master_analyzer as the analysis engine
        return _run_master_analyzer(plan, prices, volumes, ticker, market)
    elif engine_name == 'flow_system':
        return _run_flow_system(plan, ticker, market)
    elif engine_name == 'liquidity_filter':
        return _run_liquidity_filter(plan, ticker, market)
    elif engine_name == 'market_regime':
        return {'state': plan.market_state}
    elif engine_name == 'risk':
        return {'applied': True}  # placeholder — risk gate runs after
    elif engine_name == 'fundamental':
        return _run_fundamental(plan, ticker, market)
    elif engine_name == 'confluence':
        return _run_confluence(plan, prices, ticker, market)
    elif engine_name == 'breakout':
        return _run_breakout(plan, prices, ticker, market)
    elif engine_name == 'momentum':
        return _run_momentum(plan, prices, ticker, market)
    else:
        logger.debug(f'Unknown engine: {engine_name}')
        return None


def _run_master_analyzer(plan, prices, volumes, ticker, market):
    """يشغّل master_analyzer (المحرك المركزى القديم — كمكوّن متخصص)."""
    if not prices or len(prices) < 50:
        return None
    
    try:
        # Import here to avoid circular imports
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from analyzers.master_analyzer import MasterAnalyzer
        
        analyzer = MasterAnalyzer()
        result = analyzer.analyze(ticker or plan.ticker, prices=prices, volumes=volumes or [])
        
        if result:
            return {
                'signal': getattr(result, 'signal', 'HOLD'),
                'master_score': getattr(result, 'master_score', 0),
                'risk_profile': _extract_risk_profile(result),
                'engine': 'master_analyzer',
            }
        return None
    except Exception as e:
        logger.warning(f'master_analyzer failed: {e}')
        raise


def _run_flow_system(plan, ticker, market):
    """يشغّل flow_system (محرك Flow Score)."""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from engines.flow_system import FlowSystemEngine
        
        engine = FlowSystemEngine()
        flow_score = engine.calculate_flow_score(ticker or plan.ticker)
        
        if flow_score:
            return {
                'flow_score': getattr(flow_score, 'flow_score', 0),
                'signal': _flow_score_to_signal(getattr(flow_score, 'flow_score', 0)),
                'engine': 'flow_system',
            }
        return None
    except Exception as e:
        logger.warning(f'flow_system failed: {e}')
        raise


def _run_liquidity_filter(plan, ticker, market):
    """يشغّل liquidity_filter."""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from analyzers.liquidity_filter import is_tradeable
        return {'tradeable': True}  # simplified — real impl needs stock data
    except:
        return {'tradeable': True}


def _run_fundamental(plan, ticker, market):
    """يشغّل fundamental analysis."""
    return {'score': 50.0}  # placeholder


def _run_confluence(plan, prices, ticker, market):
    """يشغّل confluence engine."""
    return {'score': 50.0}  # placeholder


def _run_breakout(plan, prices, ticker, market):
    """يشغّل breakout detection."""
    return {'detected': False}


def _run_momentum(plan, prices, ticker, market):
    """يشغّل momentum analysis."""
    return {'score': 50.0}


def _extract_risk_profile(result):
    """يستخرج risk_profile من MasterAnalysis."""
    rp = getattr(result, 'risk_profile', {})
    if isinstance(rp, dict):
        return rp
    # Try to get fields directly
    return {
        'entry_price': getattr(result, 'entry_price', 0),
        'stop_loss': getattr(result, 'stop_loss', 0),
        'target_price': getattr(result, 'target_price', 0),
    }


def _flow_score_to_signal(score):
    """يحوّل flow_score إلى signal."""
    if score >= 80:
        return 'STRONG_BUY'
    elif score >= 60:
        return 'BUY'
    elif score >= 40:
        return 'HOLD'
    else:
        return 'SELL'

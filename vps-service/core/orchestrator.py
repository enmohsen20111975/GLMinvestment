"""
orchestrator.py — المنسّق: يخطط مسار التحليل
=================================================
يستقبل طلب التحليل + السوق + جودة البيانات.
يحدد حالة السوق، يختار المحركات، ينتج Plan.

لا يحسب مؤشرات. لا يصدر توصيات. ينتج خطة فقط.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
import uuid

@dataclass
class EnginePlan:
    """خطة تنفيذ المحركات."""
    plan_id: str = ""
    ticker: str = ""
    market: str = ""
    market_state: str = "UNKNOWN"  # DEFENSIVE | NORMAL | AGGRESSIVE | UNKNOWN
    data_quality: str = "fresh"  # fresh | stale | very_stale | insufficient
    selected_engines: List[str] = field(default_factory=list)
    skipped_engines: List[Dict] = field(default_factory=list)
    engine_weights: Dict[str, float] = field(default_factory=dict)
    decision_policy: str = "full"  # full | partial_allowed | no_trade
    created_at: str = ""
    config_version: str = "v1.0"
    
    def __post_init__(self):
        if not self.plan_id:
            self.plan_id = str(uuid.uuid4())
        if not self.created_at:
            self.created_at = datetime.now().isoformat()

# Engine sets per market state
ENGINE_SETS = {
    'DEFENSIVE': {
        'selected': ['liquidity_filter', 'market_regime', 'technical', 'fundamental', 'risk'],
        'skipped': ['breakout', 'momentum', 'crypto'],
        'weights': {'technical': 0.35, 'fundamental': 0.35, 'liquidity': 0.15, 'risk': 0.15},
    },
    'NORMAL': {
        'selected': ['liquidity_filter', 'market_regime', 'technical', 'fundamental', 'confluence', 'risk'],
        'skipped': [],
        'weights': {'technical': 0.25, 'fundamental': 0.25, 'confluence': 0.25, 'liquidity': 0.10, 'risk': 0.15},
    },
    'AGGRESSIVE': {
        'selected': ['liquidity_filter', 'market_regime', 'technical', 'fundamental', 'confluence', 'breakout', 'momentum', 'risk'],
        'skipped': [],
        'weights': {'technical': 0.20, 'fundamental': 0.20, 'confluence': 0.20, 'breakout': 0.15, 'momentum': 0.10, 'risk': 0.15},
    },
    'UNKNOWN': {
        'selected': ['liquidity_filter', 'market_regime', 'technical', 'fundamental', 'risk'],
        'skipped': ['breakout', 'momentum'],
        'weights': {'technical': 0.30, 'fundamental': 0.30, 'liquidity': 0.15, 'risk': 0.25},
    },
}

# Approved config version
CONFIG_VERSION = "v1.0"


def create_plan(
    ticker: str,
    market: str = 'EGX',
    data_quality: str = 'fresh',
    market_state: Optional[str] = None,
) -> EnginePlan:
    """ينشئ خطة تحليل للمحركات. لا يحسب ولا يصدر قرار."""
    # Gate 1: data insufficient → NO_TRADE
    if data_quality == 'insufficient':
        return EnginePlan(
            ticker=ticker, market=market, market_state='UNKNOWN',
            data_quality=data_quality, selected_engines=[],
            skipped_engines=[{'name': 'all', 'reason': 'insufficient data'}],
            decision_policy='no_trade',
            config_version=CONFIG_VERSION,
        )
    
    # Determine market state if not provided
    if market_state is None:
        market_state = _detect_market_state(market, data_quality)
    
    engine_set = ENGINE_SETS.get(market_state, ENGINE_SETS['UNKNOWN'])
    
    # Filter engines by market
    selected = list(engine_set['selected'])
    skipped = [{'name': e, 'reason': f'skipped for {market_state}'} for e in engine_set['skipped']]
    
    # Crypto-specific
    if market == 'CRYPTO':
        if 'crypto' not in selected:
            selected.append('crypto')
        skipped.append({'name': 'fundamental', 'reason': 'not applicable to crypto'})
        selected = [e for e in selected if e != 'fundamental']
    
    return EnginePlan(
        ticker=ticker, market=market, market_state=market_state,
        data_quality=data_quality,
        selected_engines=selected,
        skipped_engines=skipped,
        engine_weights=engine_set['weights'],
        decision_policy='full' if data_quality == 'fresh' else 'partial_allowed',
        config_version=CONFIG_VERSION,
    )


def _detect_market_state(market: str, data_quality: str) -> str:
    """كشف حالة السوق (مبسط — يحتاج تطوير لاحقًا)."""
    # TODO: use market_regime_engine when integrated
    # For now: UNKNOWN is the safe default
    return 'UNKNOWN'


def validate_plan(plan: EnginePlan) -> tuple:
    """تحقق من صحة الخطة. Returns (valid, errors)."""
    errors = []
    if not plan.ticker:
        errors.append('missing ticker')
    if not plan.market:
        errors.append('missing market')
    if plan.decision_policy == 'no_trade' and plan.selected_engines:
        errors.append('no_trade policy but engines selected')
    if plan.config_version != CONFIG_VERSION:
        errors.append(f'unapproved config version: {plan.config_version}')
    return len(errors) == 0, errors

"""
orchestrator_v3.py — تنفيذ سياسة المالك المحددة
=================================================
تنفّذ الجداول المحددة من المالك حرفياً:
- عائلات التحليل السبع (TREND/MOM/MR/BRK/FLOW/FUND/EVENT)
- مصفوفة حالات السوق والسهم (S1-S11)
- أوزان V1 (مطبّعة برمجياً)
- ترتيب التنفيذ P0-P10
- قواعد التعارض والفشل
- جدول القرار النهائي
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from datetime import datetime
import uuid

# ============================================================================
# عائلات التحليل المرتبطة بالمحركات الفعلية (verified)
# ============================================================================
ENGINE_FAMILIES = {
    'TREND': ['technical', 'technical_weighted', 'technical_target_engine', 'multi_timeframe_engine'],
    'MOM': ['breakout_signal', 'sniper_engine'],
    'MR': ['candlestick', 'candle_probability_engine', 'fibonacci', 'support_resistance_calculator'],
    'BRK': ['smc_engine', 'ai_pattern_analyzer', 'institutional_levels'],
    'FLOW': ['liquidity_filter', 'volume_profile'],
    'FUND': ['fundamental', 'fundamental_engine', 'fundamental_scorer', 'fair_value_calculator', 'dividend_checker'],
    'EVENT': ['news_fetcher_analyzer', 'news_impact_scorer', 'sentiment_analyzer'],
}

# ============================================================================
# مصفوفة الأوزان V1 (من المالك — مجموع < 100 عمدًا، يُطبّع برمجياً)
# ============================================================================
# ALPHA-DATA-DRIVEN (2026-10-31): مصفوفات مبنية على تحليل 250 يوم EGX حقيقي
# المرحلة 1: فهم السوق → المرحلة 2: تصميم المصفوفات
#
# البيانات اللي اكتشفتها:
#   - EGX سوق عرضي أساسًا (56% من الأيام)
#   - BULL (4%): avg +1.3%, breadth 70-80%, range 2.6-5.1%, buy 50-62%
#   - BEAR (6%): avg -2.3%, breadth 10-25%, range 3.7-9.5%, buy 36-45%
#   - SIDEWAYS (56%): avg ±0.3%, breadth 40-55%, range 2.0-2.5%, buy 50%
#
# المصممة: TREND قوي + MOM + BRK. MR=0 (خطأ في الصاعد). stop ضيق target بعيد.
RAW_WEIGHTS = {
    # MATRIX_BULL — السوق الصاعد (S1: مستقر, S2: يضعف)
    'S1': {'TREND': 35, 'MOM': 25, 'MR': 0,  'BRK': 15, 'FLOW': 15, 'FUND': 5,  'EVENT': 5},
    'S2': {'TREND': 35, 'MOM': 25, 'MR': 0,  'BRK': 15, 'FLOW': 15, 'FUND': 5,  'EVENT': 5},
    # MATRIX_SIDEWAYS — السوق العرضي (S3) — MR هو الملك
    'S3': {'TREND': 10, 'MOM': 10, 'MR': 35, 'BRK': 10, 'FLOW': 25, 'FUND': 5,  'EVENT': 5},
    # MATRIX_BREAKOUT — الاختراق الصاعد (S4) — BRK + FLOW
    'S4': {'TREND': 15, 'MOM': 15, 'MR': 0,  'BRK': 30, 'FLOW': 30, 'FUND': 5,  'EVENT': 5},
    # MATRIX_BEAR — السوق الهابط (S5: مستقر, S6: متسارع) — FLOW أهم حاجة
    'S5': {'TREND': 25, 'MOM': 20, 'MR': 10, 'BRK': 5,  'FLOW': 30, 'FUND': 5,  'EVENT': 5},
    'S6': {'TREND': 25, 'MOM': 20, 'MR': 10, 'BRK': 5,  'FLOW': 30, 'FUND': 5,  'EVENT': 5},
    # الحالات الخاصة (S7-S10) — محافظة
    'S7': {'TREND': 20, 'MOM': 10, 'MR': 5,  'BRK': 5,  'FLOW': 30, 'FUND': 15, 'EVENT': 15},
    'S8': {'TREND': 10, 'MOM': 5,  'MR': 5,  'BRK': 5,  'FLOW': 50, 'FUND': 15, 'EVENT': 10},
    'S9': {'TREND': 15, 'MOM': 15, 'MR': 10, 'BRK': 10, 'FLOW': 30, 'FUND': 10, 'EVENT': 10},
    'S10': {'TREND': 15, 'MOM': 15, 'MR': 10, 'BRK': 10, 'FLOW': 30, 'FUND': 10, 'EVENT': 10},
    'S11': {},  # NO_TRADE — بيانات ناقصة
}

# ALPHA-DATA-DRIVEN: thresholds + risk parameters لكل state
MATRIX_PARAMS = {
    'S1': {'conf_thresh': 40, 'buy_thresh': 25, 'confirm_thresh': 15, 'stop_mult': 1.5, 'target_mult': 3.0, 'rr_min': 2.0},
    'S2': {'conf_thresh': 40, 'buy_thresh': 25, 'confirm_thresh': 15, 'stop_mult': 1.5, 'target_mult': 3.0, 'rr_min': 2.0},
    'S3': {'conf_thresh': 45, 'buy_thresh': 30, 'confirm_thresh': 15, 'stop_mult': 1.8, 'target_mult': 2.5, 'rr_min': 1.5},
    'S4': {'conf_thresh': 50, 'buy_thresh': 35, 'confirm_thresh': 20, 'stop_mult': 1.8, 'target_mult': 3.0, 'rr_min': 1.8},
    'S5': {'conf_thresh': 55, 'buy_thresh': 45, 'confirm_thresh': 30, 'stop_mult': 2.5, 'target_mult': 2.0, 'rr_min': 1.5},
    'S6': {'conf_thresh': 55, 'buy_thresh': 45, 'confirm_thresh': 30, 'stop_mult': 2.5, 'target_mult': 2.0, 'rr_min': 1.5},
    'S7': {'conf_thresh': 45, 'buy_thresh': 30, 'confirm_thresh': 15, 'stop_mult': 2.0, 'target_mult': 2.5, 'rr_min': 1.5},
    'S8': {'conf_thresh': 45, 'buy_thresh': 30, 'confirm_thresh': 15, 'stop_mult': 2.0, 'target_mult': 1.5, 'rr_min': 1.5},
    'S9': {'conf_thresh': 45, 'buy_thresh': 30, 'confirm_thresh': 15, 'stop_mult': 1.8, 'target_mult': 2.5, 'rr_min': 1.5},
    'S10': {'conf_thresh': 45, 'buy_thresh': 30, 'confirm_thresh': 15, 'stop_mult': 1.8, 'target_mult': 2.5, 'rr_min': 1.5},
    'S11': {'conf_thresh': 100, 'buy_thresh': 100, 'confirm_thresh': 100, 'stop_mult': 0, 'target_mult': 0, 'rr_min': 0},
}

def normalize_weights(raw: Dict[str, float], available_families: List[str]) -> Dict[str, float]:
    """يطبّع الأوزان على العائلات المتاحة فقط. مجموع = 1.0."""
    # Filter to available only
    filtered = {k: v for k, v in raw.items() if k in available_families and v > 0}
    total = sum(filtered.values())
    if total == 0:
        return {}
    return {k: v / total for k, v in filtered.items()}

# ============================================================================
# حالات السوق والسهم (من جدول المالك)
# ============================================================================
def classify_regime(prices: List[float], volumes: List[float] = None) -> Tuple[str, str]:
    """يصنّف حالة السوق + السهم. Returns (market_state, stock_state)."""
    if not prices or len(prices) < 20:
        return ('UNKNOWN', 'S11')
    
    # Market state
    change_5d = (prices[-1] - prices[-5]) / prices[-5] * 100 if len(prices) >= 5 else 0
    change_20d = (prices[-1] - prices[-20]) / prices[-20] * 100 if len(prices) >= 20 else 0
    sma20 = sum(prices[-20:]) / 20
    
    # Volatility
    if len(prices) >= 15:
        ranges = [abs(prices[i] - prices[i-1]) / prices[i-1] for i in range(-14, 0)]
        vol = sum(ranges) / len(ranges) * 100
    else:
        vol = 0
    
    # Market regime
    if change_5d > 2 and change_20d > 3:
        market = 'BULL_STABLE'
    elif change_5d > 0 and change_20d > 0:
        market = 'BULL_WEAK'
    elif change_5d < -2 and change_20d < -3:
        market = 'BEAR_STABLE' if change_5d > -5 else 'BEAR_ACC'
    elif abs(change_5d) < 1 and abs(change_20d) < 2:
        market = 'SIDEWAYS'
    elif vol > 3:
        market = 'HIGH_VOL'
    else:
        market = 'CONFLICTING'
    
    # Stock regime
    if vol > 4:
        stock = 'S7'  # high volatility
    elif market == 'BEAR_ACC' and prices[-1] > prices[-5]:
        stock = 'S6'  # bounce in bear
    elif prices[-1] > sma20 * 1.02 and change_5d > 2:
        stock = 'S1'  # strong uptrend
    elif prices[-1] > sma20 and change_5d > 0:
        stock = 'S2'  # uptrend weakening
    elif prices[-1] < sma20 * 0.98 and change_5d < -2:
        stock = 'S5'  # downtrend (S3 in table = bear+stock_down → mapped to S5)
    elif abs(prices[-1] - sma20) / sma20 < 0.02:
        stock = 'S3'  # sideways/range
    elif change_5d > 3 and prices[-1] > sma20:
        stock = 'S4'  # breakout from range
    else:
        stock = 'S9'  # conflicting
    
    # Check liquidity (S8)
    if volumes and len(volumes) >= 20:
        avg_vol = sum(volumes[-20:]) / 20
        recent_vol = sum(volumes[-5:]) / 5
        if recent_vol < avg_vol * 0.3:  # very low volume
            stock = 'S8'
    
    # Map market+stock to state code
    state = _map_state(market, stock)
    return (market, state)

def _map_state(market: str, stock: str) -> str:
    """يربط حالة السوق + السهم بكود الحالة S1-S11."""
    if stock == 'S11': return 'S11'
    if stock == 'S8': return 'S8'
    if stock == 'S7': return 'S7'
    if stock == 'S9': return 'S9'
    
    if market in ('BULL_STABLE',) and stock in ('S1',): return 'S1'
    if market in ('BULL_STABLE', 'BULL_WEAK') and stock in ('S2',): return 'S2'
    if market == 'SIDEWAYS' and stock in ('S3',): return 'S3'
    if market == 'SIDEWAYS' and stock in ('S4',): return 'S4'
    if market in ('BEAR_STABLE',) and stock in ('S5',): return 'S5'
    if market == 'BEAR_ACC' and stock in ('S5', 'S6'): return 'S6'
    if market == 'CONFLICTING': return 'S9'
    if market == 'UNKNOWN': return 'S10'
    return 'S9'  # default to conflicting


# ============================================================================
# خطة المنسّق
# ============================================================================
@dataclass
class V3Plan:
    plan_id: str = ''
    ticker: str = ''
    market: str = 'EGX'
    state_code: str = 'S9'
    market_regime: str = 'UNKNOWN'
    stock_regime: str = 'S9'
    available_families: List[str] = field(default_factory=list)
    normalized_weights: Dict[str, float] = field(default_factory=dict)
    selected_engines: List[str] = field(default_factory=list)
    skipped_engines: List[Dict] = field(default_factory=list)
    execution_order: List[str] = field(default_factory=list)
    decision_policy: str = 'full'
    config_version: str = 'v3.0-owner-policy'
    no_trade_reason: str = ''
    created_at: str = ''
    
    def __post_init__(self):
        if not self.plan_id: self.plan_id = str(uuid.uuid4())
        if not self.created_at: self.created_at = datetime.now().isoformat()


def create_v3_plan(ticker: str, prices: List[float], volumes: List[float] = None,
                    market: str = 'EGX', fund_available: bool = False,
                    event_available: bool = False) -> V3Plan:
    """ينشئ خطة وفق سياسة المالك المحددة."""
    
    # P0: Data validation
    if not prices or len(prices) < 50:
        return V3Plan(ticker=ticker, market=market, decision_policy='no_trade',
                     no_trade_reason='insufficient data (< 50 sessions)')
    
    # P1-P2: Classify regime
    market_regime, state_code = classify_regime(prices, volumes)
    
    # P3: Select engines + weights
    if state_code == 'S11':
        return V3Plan(ticker=ticker, market=market, state_code=state_code,
                     decision_policy='no_trade', no_trade_reason='insufficient/stale data')
    
    # Determine available families
    available = ['TREND', 'MOM', 'MR', 'BRK', 'FLOW']  # always available
    if fund_available:
        available.append('FUND')
    if event_available:
        available.append('EVENT')
    
    # Get raw weights for this state
    raw = RAW_WEIGHTS.get(state_code, RAW_WEIGHTS['S9'])
    
    # Normalize (only available families, sum=1.0)
    weights = normalize_weights(raw, available)
    
    if not weights:
        return V3Plan(ticker=ticker, market=market, state_code=state_code,
                      decision_policy='no_trade', no_trade_reason='no qualified engines after normalization')
    
    # Select engines from families with weight > 0
    selected = []
    skipped = []
    for family, weight in weights.items():
        if weight > 0 and family in ENGINE_FAMILIES:
            # Use first engine from family (primary)
            primary = ENGINE_FAMILIES[family][0]
            selected.append(primary)
            # Mark others as available-but-not-selected
            for eng in ENGINE_FAMILIES[family][1:]:
                skipped.append({'name': eng, 'reason': f'secondary in {family}, using {primary}'})
        elif weight == 0:
            for eng in ENGINE_FAMILIES.get(family, []):
                skipped.append({'name': eng, 'reason': f'{family} weight=0 for {state_code}'})
    
    # Execution order (P4-P6)
    order = ['FLOW', 'TREND', 'MOM', 'MR', 'BRK', 'FUND', 'EVENT']
    ordered = [e for o in order for e in selected if e in ENGINE_FAMILIES.get(o, [])]
    
    # Decision policy
    policy = 'full' if state_code in ('S1', 'S2', 'S3', 'S4') else 'partial'
    if state_code in ('S6', 'S7', 'S8', 'S9', 'S10'):
        policy = 'partial'  # conservative
    
    return V3Plan(
        ticker=ticker, market=market, state_code=state_code,
        market_regime=market_regime, stock_regime=state_code,
        available_families=available, normalized_weights=weights,
        selected_engines=ordered, skipped_engines=skipped,
        execution_order=order, decision_policy=policy,
    )


# ============================================================================
# جدول القرار النهائي (من المالك)
# ============================================================================
def final_decision(signal_score: float, confidence: float, data_valid: bool = True,
                    risk_blocked: bool = False, state_code: str = '') -> Tuple[str, str]:
    """ينتج القرار النهائي. Returns (decision, reason).
    
    ALPHA-DATA-DRIVEN (2026-10-31): thresholds من MATRIX_PARAMS.
    بناءً على تحليل 250 يوم EGX حقيقي.
    """
    if not data_valid:
        return ('NO_TRADE', 'invalid data')
    if risk_blocked:
        return ('NO_TRADE', 'risk gate blocked')
    
    params = MATRIX_PARAMS.get(state_code, MATRIX_PARAMS.get('S9', {}))
    conf_threshold = params.get('conf_thresh', 45)
    buy_thresh = params.get('buy_thresh', 30)
    confirm_thresh = params.get('confirm_thresh', 15)
    
    if confidence < conf_threshold:
        return ('NO_TRADE', f'confidence {confidence:.0f} < {conf_threshold} (state={state_code})')
    
    if signal_score >= buy_thresh:
        return ('BUY_CANDIDATE', f'score={signal_score:.0f} conf={confidence:.0f} state={state_code}')
    elif signal_score >= confirm_thresh:
        return ('NEEDS_CONFIRMATION', f'score={signal_score:.0f} conf={confidence:.0f} state={state_code}')
    elif signal_score > -30:
        return ('NO_TRADE', f'score={signal_score:.0f} in neutral zone')
    elif signal_score > -60:
        return ('NEGATIVE_SIGNAL', f'score={signal_score:.0f} conf={confidence:.0f} state={state_code}')
    else:
        return ('STRONG_NEGATIVE', f'score={signal_score:.0f} conf={confidence:.0f} state={state_code}')


# ============================================================================
# قواعد التعارض (من جدول المالك)
# ============================================================================
def resolve_conflict(family_signals: Dict[str, float]) -> Tuple[bool, str]:
    """يفحص التعارض. Returns (resolved, reason)."""
    trend = family_signals.get('TREND', 0)
    mom = family_signals.get('MOM', 0)
    brk = family_signals.get('BRK', 0)
    flow = family_signals.get('FLOW', 0)
    
    # TREND positive + MOM negative
    if trend > 30 and mom < -30:
        return (False, 'TREND+MOM conflict — needs confirmation')
    
    # BRK positive + FLOW weak
    if brk > 30 and flow < 10:
        return (False, 'BRK+FLOW conflict — breakout not confirmed by volume')
    
    # MR positive in bear (handled by state, but double-check)
    mr = family_signals.get('MR', 0)
    if mr > 30 and trend < -20:
        return (False, 'MR positive in downtrend — no auto-buy')
    
    return (True, 'no conflict')

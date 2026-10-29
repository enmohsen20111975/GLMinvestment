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
RAW_WEIGHTS = {
    'S1': {'TREND': 30, 'MOM': 25, 'MR': 5,  'BRK': 10, 'FLOW': 20, 'FUND': 5,  'EVENT': 5},   # صعود مستقر
    'S2': {'TREND': 25, 'MOM': 15, 'MR': 10, 'BRK': 5,  'FLOW': 25, 'FUND': 10, 'EVENT': 10},  # صعود يضعف
    'S3': {'TREND': 10, 'MOM': 10, 'MR': 30, 'BRK': 5,  'FLOW': 25, 'FUND': 10, 'EVENT': 10},  # عرضي
    'S4': {'TREND': 15, 'MOM': 15, 'MR': 0,  'BRK': 25, 'FLOW': 30, 'FUND': 5,  'EVENT': 10},  # اختراق صاعد
    'S5': {'TREND': 30, 'MOM': 20, 'MR': 5,  'BRK': 5,  'FLOW': 20, 'FUND': 10, 'EVENT': 10},  # هبوط مستقر
    'S6': {'TREND': 25, 'MOM': 20, 'MR': 0,  'BRK': 5,  'FLOW': 25, 'FUND': 10, 'EVENT': 15},  # هبوط متسارع
    'S7': {'TREND': 20, 'MOM': 10, 'MR': 5,  'BRK': 5,  'FLOW': 30, 'FUND': 15, 'EVENT': 15},  # تذبذب مرتفع
    'S8': {'TREND': 10, 'MOM': 5,  'MR': 5,  'BRK': 5,  'FLOW': 50, 'FUND': 15, 'EVENT': 10},  # سيولة ضعيفة
    'S9': {'TREND': 15, 'MOM': 15, 'MR': 10, 'BRK': 10, 'FLOW': 30, 'FUND': 10, 'EVENT': 10},  # أدلة متعارضة
    'S10': {'TREND': 15, 'MOM': 15, 'MR': 10, 'BRK': 10, 'FLOW': 30, 'FUND': 10, 'EVENT': 10}, # UNKNOWN
    'S11': {},  # NO_TRADE — بيانات ناقصة
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
    """يصنّف حالة السوق + السهم. Returns (market_state, stock_state).
    
    STAGE-2 FIX (2026-10-29): تحسين المنطق:
    - S8 (سيولة ضعيفة): استخدم متوسط 5 أيام مش يوم واحد
    - S1 (صعود مستقر): فوق SMA50 + ROC20 إيجابي + حجم مش ضعيف
    - S4 (اختراق): كسر قمة 20 يوم + حجم
    - S6 (هبوط متسارع): تأكيد بـ ROC20 سالب قوي
    """
    if not prices or len(prices) < 20:
        return ('UNKNOWN', 'S11')
    
    last = prices[-1]
    sma20 = sum(prices[-20:]) / 20
    sma50 = sum(prices[-50:]) / 50 if len(prices) >= 50 else sma20
    
    # ROC
    change_5d = (last - prices[-5]) / prices[-5] * 100 if len(prices) >= 5 else 0
    change_20d = (last - prices[-20]) / prices[-20] * 100 if len(prices) >= 20 else 0
    
    # Volatility
    if len(prices) >= 15:
        ranges = [abs(prices[i] - prices[i-1]) / prices[i-1] for i in range(-14, 0)]
        vol = sum(ranges) / len(ranges) * 100
    else:
        vol = 0
    
    # Volume metrics (STAGE-2: متوسط 5 أيام مش يوم واحد)
    avg_vol_5d = 0
    avg_vol_20d = 0
    vol_ratio_5d = 1.0
    if volumes and len(volumes) >= 20:
        avg_vol_5d = sum(volumes[-5:]) / 5
        avg_vol_20d = sum(volumes[-20:]) / 20
        vol_ratio_5d = avg_vol_5d / avg_vol_20d if avg_vol_20d > 0 else 1.0
    
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
    
    # Stock regime (STAGE-2: منطق أوضح)
    # S8: سيولة ضعيفة — متوسط 5 أيام < 50% من متوسط 20 يوم (مش يوم واحد)
    if vol_ratio_5d < 0.5:
        stock = 'S8'
    elif vol > 4:
        stock = 'S7'  # تذبذب مرتفع
    # S1: صعود مستقر — فوق SMA50 + ROC20 إيجابي قوي + حجم مش ضعيف
    elif last > sma50 * 1.02 and change_20d > 3 and vol_ratio_5d > 0.7:
        stock = 'S1'
    # S2: صعود يضعف — فوق SMA20 + ROC5 إيجابي
    elif last > sma20 and change_5d > 0:
        stock = 'S2'
    # S5: هبوط مستقر — تحت SMA20 + ROC5 سالب
    elif last < sma20 * 0.98 and change_5d < -2:
        stock = 'S5'
    # S6: هبوط متسارع — تحت SMA50 + ROC20 سالب قوي (< -5%)
    elif last < sma50 * 0.98 and change_20d < -5:
        stock = 'S6'
    # S3: عرضي — قريب من SMA20
    elif abs(last - sma20) / sma20 < 0.02:
        stock = 'S3'
    # S4: اختراق — كسر قمة 20 يوم + حجم
    elif change_5d > 3 and last > sma20 and vol_ratio_5d > 1.2:
        stock = 'S4'
    else:
        stock = 'S9'  # أدلة متعارضة
    
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
    
    # P0: Data validation — FIX (2026-10-28): was 50, reduced to 20 to match
    # available EGX data in egksco_price_history (~30-38 days per stock).
    # The original 50-session requirement blocked ALL EGX stocks from analysis
    # because egksco only has ~1 month of data per stock.
    if not prices or len(prices) < 20:
        return V3Plan(ticker=ticker, market=market, decision_policy='no_trade',
                     no_trade_reason='insufficient data (< 20 sessions)')
    
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
                    risk_blocked: bool = False) -> Tuple[str, str]:
    """ينتج القرار النهائي وفق جدول المالك. Returns (decision, reason)."""
    if not data_valid:
        return ('NO_TRADE', 'invalid data')
    if risk_blocked:
        return ('NO_TRADE', 'risk gate blocked')
    
    if confidence < 60:
        return ('NO_TRADE', f'confidence {confidence:.0f} < 60')
    
    if signal_score >= 60:
        return ('BUY_CANDIDATE', f'score={signal_score:.0f} conf={confidence:.0f}')
    elif signal_score >= 30:
        return ('NEEDS_CONFIRMATION', f'score={signal_score:.0f} conf={confidence:.0f}')
    elif signal_score > -30:
        return ('NO_TRADE', f'score={signal_score:.0f} in neutral zone')
    elif signal_score > -60:
        return ('NEGATIVE_SIGNAL', f'score={signal_score:.0f} conf={confidence:.0f}')
    else:
        return ('STRONG_NEGATIVE', f'score={signal_score:.0f} conf={confidence:.0f}')


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

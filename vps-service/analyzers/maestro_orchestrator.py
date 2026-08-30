"""
Unified Maestro Orchestrator - THE BRAIN
@version 3.1.0 - Maestro Human
"""

import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
import sqlite3
import os
import sys
import json
import re
from pathlib import Path

logger = logging.getLogger(__name__)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.multi_timeframe_engine import analyze_timeframes, TimeframeAnalysis
from analyzers.news_stop_filter import (
    check_news_stop_filter, check_circuit_breaker,
    apply_circuit_breaker_to_recommendation,
    NewsStopFilterResult, CircuitBreakerResult
)
from analyzers.master_analyzer import MasterAnalyzer
from core.database import DatabaseManager

try:
    from analyzers.fair_value_calculator import FairValueCalculator
    FAIR_VALUE_AVAILABLE = True
except ImportError:
    FAIR_VALUE_AVAILABLE = False

# P24-ADAPTIVE-MAESTRO: ربط أوزان تكييفية بحالة السوق
try:
    from analyzers.adaptive_weights import get_adaptive_weights
    ADAPTIVE_WEIGHTS_AVAILABLE = True
except ImportError:
    ADAPTIVE_WEIGHTS_AVAILABLE = False

try:
    from analyzers.expert_memory import ExpertMemoryEngineV3, check_signal_memory_v3
    EXPERT_MEMORY_AVAILABLE = True
    EXPERT_MEMORY_VERSION = 3
except ImportError:
    try:
        from analyzers.expert_memory import ExpertMemoryEngineV2, check_signal_memory_v2
        EXPERT_MEMORY_AVAILABLE = True
        EXPERT_MEMORY_VERSION = 2
    except ImportError:
        EXPERT_MEMORY_AVAILABLE = False
        EXPERT_MEMORY_VERSION = 0

try:
    from analyzers.prediction_tracker import PredictionTracker
    PREDICTION_TRACKER_AVAILABLE = True
except ImportError:
    PREDICTION_TRACKER_AVAILABLE = False

# Unified Persona Engine (gambler + investor)
try:
    from analyzers.persona_gambler import analyze_gambler, gambler_to_dict
    from analyzers.persona_investor import analyze_investor, investor_to_dict
    PERSONA_ENGINE_AVAILABLE = True
except ImportError as _pe:
    print(f"[Maestro] Persona Engine not available: {_pe}")
    PERSONA_ENGINE_AVAILABLE = False

try:
    from analyzers.dynamic_target_engine import DynamicTargetEngine
    DYNAMIC_TARGET_AVAILABLE = True
except ImportError:
    DYNAMIC_TARGET_AVAILABLE = False

# P24-ADAPTIVE-RR (Aug 2026): adaptive R/R multipliers by persona + regime + volatility.
try:
    from analyzers.core_scoring_engine import adaptive_rr as _adaptive_rr
    ADAPTIVE_RR_AVAILABLE = True
except ImportError:
    ADAPTIVE_RR_AVAILABLE = False

    def _adaptive_rr(*args, **kwargs):
        return None

# P26-PERSONA-SEPARATION (Aug 2026): persona-specific target/stop percentages.
# ده اللي بيخلي المضارب والمستثمر يطلعوا أرقام مختلفة جذرياً (مش نفس النتيجة).
try:
    from analyzers.core_scoring_engine import compute_persona_rr_overrides as _compute_persona_rr
    PERSONA_RR_AVAILABLE = True
except ImportError:
    PERSONA_RR_AVAILABLE = False

    def _compute_persona_rr(*args, **kwargs):
        return None

_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
PREDICTIONS_DB = os.environ.get('PREDICTIONS_DB', str(_PROJECT_ROOT / 'db' / 'predictions.db'))


@dataclass
class RegimePhaseResult:
    phase: str
    confidence: float
    score: float
    signals: List[str]
    sma_alignment: Optional[str] = None
    roc_value: Optional[float] = None


@dataclass
class TimeframePhaseResult:
    confluence_score: float
    aligned: bool
    aligned_count: int
    daily_trend: str
    signals: List[str]
    details: Optional[Dict] = None


@dataclass
class VolumePhaseResult:
    liquidity_rating: str
    volume_ratio: float
    volume_above_avg: bool
    signals: List[str]
    current_volume: int = 0
    avg_volume_20: int = 0
    avg_value_traded: float = 0


@dataclass
class NewsPhaseResult:
    has_news: bool
    has_cbe_news: bool
    should_hold: bool
    risk_level: str
    signals: List[str]
    news_count: int = 0


@dataclass
class PersonaResult:
    persona_type: str
    adjusted_score: float
    position_size_percent: float
    notes: List[str]


@dataclass
class ExpertMemoryResult:
    found_similar: bool
    total_similar: int
    win_rate: float
    avg_pnl: float
    confidence_adjustment: float
    recommendation: str
    reason: str
    pattern_type: str = 'none'
    # D2 (Effective Learning): تأثير مسقوف على وقف الخسارة (مش الثقة بس).
    # لو فيه درس STOP_TOO_TIGHT متكرر → نوسّع الوقف بنسبة ATR ضمن سقف.
    # ده بـ يغيّر الـ RR فعلياً. السقف: 0.5 ATR + 15% من entry.
    stop_widen_atr: float = 0.0
    applied_lesson: str = ''        # وصف التغيير المطبّق (للـ log والإثبات)
    # 🔥 VERIFY-RL: Positive reinforcement — رفع الـ target من دروس EARLY_BREAKOUT.
    # النظير الإيجابي لـ stop_widen_atr. لو الشخصية عندها EARLY_BREAKOUT متكرر
    # → ارفع الـ target لكل صفقة جديدة بمقدار +0.25R لكل تكرار (سقف +1.0R).
    # ده بـ يـ extend الهدف → يزيد العائد المحتمل بدل ما يـ capه عند T1.
    target_raise_r: float = 0.0
    # 🔥 VERIFY-RL: T1 hold-through bias من دروس TREND_RIDE.
    # لو الشخصية عندها ≥ 3 TREND_RIDE → الـ multi-target exit يـ hold خلال T1.
    t1_holdthrough_bias: float = 0.0


@dataclass
class MaestroHumanContext:
    time_context: Dict = field(default_factory=dict)
    sector_context: Dict = field(default_factory=dict)
    market_context: Dict = field(default_factory=dict)
    historical_context: Dict = field(default_factory=dict)
    behavioral_context: Dict = field(default_factory=dict)


@dataclass
class MaestroPersonas:
    hunter: Dict = field(default_factory=dict)
    momentum: Dict = field(default_factory=dict)
    value: Dict = field(default_factory=dict)


@dataclass
class MaestroNarrative:
    line1: str = ''
    line2: str = ''
    line3: str = ''


@dataclass
class MaestroResult:
    ticker: str
    timestamp: str
    maestro_score: float
    recommendation: str
    recommendation_ar: str
    confidence: float
    entry_price: float
    stop_loss: float
    target: float
    risk_reward: float
    phases: Dict[str, Any]
    persona: Optional[PersonaResult] = None
    warnings: List[str] = field(default_factory=list)
    warnings_ar: List[str] = field(default_factory=list)
    signal_id: Optional[int] = None
    expert_memory: Optional[ExpertMemoryResult] = None
    human_context: Optional[MaestroHumanContext] = None
    human_personas: Optional[MaestroPersonas] = None
    human_narrative: Optional[MaestroNarrative] = None
    # Unified Persona Engine: gambler + investor
    gambler: Optional[Dict[str, Any]] = None
    investor: Optional[Dict[str, Any]] = None
    persona_narrative: Optional[Dict[str, str]] = None
    # POSITION-SIZING-024: optional position sizing hint
    suggested_position_size_pct: Optional[float] = None
    position_warning: Optional[str] = None
    # STRATEGY-041: Live Trailing Stop
    trailing_stop: Optional[float] = None
    trailing_logic: Optional[str] = None
    # P26-PERSONA-SEPARATION: R/R الخاص بكل persona (gambler/balanced/conservative).
    # dict فيه target/stop/target_pct/stop_pct/horizon لكل persona — عشان
    # الواجهة تقدر تبدّل الشخصيات وتشوف أرقام مختلفة فوراً من غير إعادة تحليل.
    persona_rr: Optional[Dict[str, Any]] = None


# P24-ADAPTIVE-MAESTRO: أوزان مختلفة لكل حالة سوق — قبل كده كلها كانت متطابقة!
# في السوق الصاعد: التقني بيقود (الزخم يكسب)، الحجم مهم بس مش أكتر من الإشارات
# في السوق الهابط: الدعم/المقاومة أهم حاجة (الحماية)، التقني كتير بيكذب
# في العرضي: الحجم هو اللي بيكشف الاختراق، التقني معتدل
REGIME_WEIGHTS = {
    'bull': {'support_resistance': 0.40, 'volume': 0.25, 'technical': 0.35},
    'bear': {'support_resistance': 0.55, 'volume': 0.25, 'technical': 0.20},
    'range': {'support_resistance': 0.35, 'volume': 0.40, 'technical': 0.25},
    'unknown': {'support_resistance': 0.45, 'volume': 0.30, 'technical': 0.25},
}

EGX_SIGNAL_PARAMS = {
    # 🧠 الخبير: وقف وهدف واقعيين في EGX (مش -1%/-3%)
    # السهم بيتحرك 2-3% في اليوم، الوقف -1% مضمون الإصطياد
    't1_buy': {'target_pct': 4.0, 'stop_loss_pct': 8.0, 'min_volume_ratio': 1.2, 'support_threshold': 4.0},
    'swing_buy': {'target_pct': 10.0, 'stop_loss_pct': 8.0, 'min_volume_ratio': 1.0},
    'buy': {'target_pct': 8.0, 'stop_loss_pct': 5.0, 'min_volume_ratio': 1.0},
}

# P21-PERSONA-CONSTRAINTS (Aug 2026): 3-tier persona configs.
# القيود بتتدرج حسب الـ persona_type:
#   - conservative (المحافظ): يطبّق Veto كامل لو السوق هابط أو السهم قريب من المقاومة.
#     الحد الأدنى لـ BUY أعلى عشان يحمي رأس المال.
#   - balanced (المتوازن): نخفف الـ Veto. لو master_score > 45 → ACCUMULATE/BUY.
#   - gambler (المضارب): بدون Veto نهائياً. BUY لو master_score > 35 — يلحق الزخم اللحظي.
#
# V34-PERSONA-FIX (Aug 2026): تعديل العتبات والـ R/R بحيث كل persona يلعب بطريقة مختلفة فعلاً.
# المشكلة السابقة: conservative (min=60) كان بيدخل صفقات قليلة جداً بـ R/R محدود (1.8x) فالأرباح
# كانت صغيرة وأي خسارة بتاكلها. gambler (min=35) كان بيدخل أي حاجة فنصها خسارة.
# الحل: قللنا فجوة الـ thresholds + رفعنا R/R للـ conservative + قللنا R/R للـ gambler.
# كمان أضفنا `strategy` و `focus_engines` عشان كل persona يركز على محركات مختلفة.

# PILLAR-5 PERSONA INPUT WEIGHTS — imported from adaptive_weights.py
# الـ matrix دي بـ differentiate الـ personas جذريًا: gambler بـ يتجاهل الأساسيات (0%)
# و conservative بـ يحكمها (60%). بـ تـ feed الـ conviction score computation.
try:
    from analyzers.adaptive_weights import (
        get_persona_input_weights,
        apply_persona_weighting_to_score,
        PERSONA_INPUT_WEIGHTS as _PILLAR5_PERSONA_INPUT_WEIGHTS,
    )
except ImportError:
    # Defensive fallback — should never happen in production
    get_persona_input_weights = None
    apply_persona_weighting_to_score = None
    _PILLAR5_PERSONA_INPUT_WEIGHTS = None

PERSONA_CONFIGS = {
    'conservative': {
        'min_score': 55,           # كان 60 — قللناه عشان يدخل صفقات أكثر
        'max_position_percent': 8, # كان 5 — رفعناه عشان يستفيد من الفرص الجيدة
        'risk_tolerance': 'low',
        'target_mult': 2.5,        # كان 1.8 — رفعناه عشان الأرباح تكون أكبر من الخسائر
        'stop_mult': 1.0,          # كان 0.8 — رفعناه عشان الوقف يكون أوسع شوية (يقلل الـ whipsaws)
        'strategy': 'fundamentals_first',
        'strategy_ar': 'أساسي أولاً — أسهم قوية بأسعار عادلة',
        'focus_engines': ['fundamental', 'sector_relative', 'multi_timeframe', 'trend'],
        'min_hold_days': 14,       # المستثمر بيمسك أسبوعين على الأقل
    },
    'balanced': {
        'min_score': 50,           # زي ما هو
        'max_position_percent': 10,
        'risk_tolerance': 'medium',
        'target_mult': 2.2,        # زي ما هو
        'stop_mult': 1.0,
        'strategy': 'mixed',
        'strategy_ar': 'مختلط — أساسي + فني + زخم',
        'focus_engines': ['fundamental', 'enhanced_indicators', 'smc', 'sector_relative'],
        'min_hold_days': 5,
    },
    'gambler': {
        'min_score': 42,           # كان 35 — رفعناه عشان يقل الصفقات الخاسرة
        'max_position_percent': 12, # كان 15 — قللناه عشان يقل المخاطرة
        'risk_tolerance': 'high',
        'target_mult': 2.0,        # كان 3.0 — قللناه عشان الهدف يكون أقرب (أكثر تحققاً)
        'stop_mult': 1.2,          # كان 1.5 — قللناه عشان الخسارة تكون أصغر
        'strategy': 'momentum_first',
        'strategy_ar': 'زخم أولاً — انفجارات SMC + volume surges',
        'focus_engines': ['smc', 'enhanced_indicators', 'ai_pattern', 'volume_profile'],
        'min_hold_days': 1,        # المضارب بيومي
    },
    # أسماء بديلة (legacy aliases) — أي حد يمرّر investor/active_trader يشتغل صح
    'investor':     {
        'min_score': 55, 'max_position_percent': 8,  'risk_tolerance': 'low',
        'target_mult': 2.5, 'stop_mult': 1.0,
        'strategy': 'fundamentals_first',
        'strategy_ar': 'أساسي أولاً — أسهم قوية بأسعار عادلة',
        'focus_engines': ['fundamental', 'sector_relative', 'multi_timeframe', 'trend'],
        'min_hold_days': 14,
    },
    'active_trader':{
        'min_score': 42, 'max_position_percent': 12, 'risk_tolerance': 'high',
        'target_mult': 2.0, 'stop_mult': 1.2,
        'strategy': 'momentum_first',
        'strategy_ar': 'زخم أولاً — انفجارات SMC + volume surges',
        'focus_engines': ['smc', 'enhanced_indicators', 'ai_pattern', 'volume_profile'],
        'min_hold_days': 1,
    },
}


def to_num(v, fallback=0) -> float:
    try:
        return float(v) if v is not None else fallback
    except (ValueError, TypeError):
        return fallback


def parse_percentage(pct_str) -> float:
    if not pct_str:
        return 0.0
    if isinstance(pct_str, (int, float)):
        return float(pct_str)
    try:
        clean = str(pct_str).replace('%', '').replace(',', '').replace('−', '-').strip()
        return float(clean) if clean else 0.0
    except Exception:
        return 0.0


def parse_number(num_str) -> float:
    if not num_str:
        return 0.0
    if isinstance(num_str, (int, float)):
        return float(num_str)
    try:
        clean = str(num_str).replace(',', '').replace('−', '-').strip()
        return float(clean) if clean else 0.0
    except Exception:
        return 0.0


def parse_volume(value) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    value_str = str(value).strip().upper().replace(' ', '').replace('\u202f', '')
    multipliers = {'K': 1_000, 'M': 1_000_000, 'B': 1_000_000_000}
    for suffix, multiplier in multipliers.items():
        if value_str.endswith(suffix):
            try:
                return int(float(value_str[:-1]) * multiplier)
            except ValueError:
                return 0
    try:
        return int(float(value_str))
    except ValueError:
        return 0


def clamp(value: float, min_val: float, max_val: float) -> float:
    return max(min_val, min(max_val, value))


def round2(n: float) -> float:
    return round(n, 2)


def _get_conn(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


# ==================== MAESTRO HUMAN: GATHER CONTEXT ====================

def _safe_pct(numerator, denominator):
    """safe percentage: لو denominator = 0 → رجّع 0. module-level helper."""
    try:
        n = float(numerator) if numerator is not None else 0.0
        d = float(denominator) if denominator is not None else 0.0
        return ((n - d) / d) * 100 if d > 0 else 0.0
    except (TypeError, ValueError, ZeroDivisionError):
        return 0.0


def gather_context(ticker: str, market: str = 'EGX') -> MaestroHumanContext:
    context = MaestroHumanContext()
    ticker_upper = ticker.upper()

    # 1. السياق الزمني
    # مراجعة (يوليو 2026): float(None) بيرمي TypeError — لازم safe_float
    def _sf(v, default=0.0):
        """safe float: لو None أو invalid → default"""
        try:
            return float(v) if v is not None else default
        except (ValueError, TypeError):
            return default

    try:
        # PHASE 1 (v3.50.0): delegate to data.prices — single source of truth
        from data.prices import load_price_history
        # load_price_history returns oldest-first with keys {close, high, low, ...}.
        # Local code expects DESC (rows[0] = most recent) + close_price/high_price/... keys.
        _ph_raw = load_price_history(ticker_upper, limit=365)
        rows = [{
            'date': r.get('date'),
            'open_price': r.get('open'),
            'high_price': r.get('high'),
            'low_price': r.get('low'),
            'close_price': r.get('close'),
            'volume': r.get('volume'),
        } for r in reversed(_ph_raw)]

        if rows:
            current_price = _sf(rows[0]['close_price'])
            if current_price <= 0:
                # لو السعر 0 أو None → skip
                context.time_context = {'error': 'no valid price'}
                return context
            dates_prices = [(r['date'], _sf(r['close_price'])) for r in rows if _sf(r['close_price']) > 0]
            if not dates_prices or len(dates_prices) < 2:
                context.time_context = {'error': 'insufficient price data'}
                return context
            high_52w = max(_sf(r['high_price']) for r in rows[:252] if _sf(r['high_price']) > 0) if any(_sf(r['high_price']) > 0 for r in rows[:252]) else current_price
            low_52w = min(_sf(r['low_price']) for r in rows[:252] if _sf(r['low_price']) > 0) if any(_sf(r['low_price']) > 0 for r in rows[:252]) else current_price

            context.time_context = {
                'current_price': current_price,
                'change_1w': round2(((dates_prices[0][1] - dates_prices[6][1]) / dates_prices[6][1]) * 100) if len(dates_prices) >= 7 else None,
                'change_1m': round2(((dates_prices[0][1] - dates_prices[29][1]) / dates_prices[29][1]) * 100) if len(dates_prices) >= 30 else None,
                'change_3m': round2(((dates_prices[0][1] - dates_prices[89][1]) / dates_prices[89][1]) * 100) if len(dates_prices) >= 90 else None,
                'change_1y': round2(((dates_prices[0][1] - dates_prices[364][1]) / dates_prices[364][1]) * 100) if len(dates_prices) >= 365 else None,
                'high_52w': high_52w,
                'low_52w': low_52w,
                'distance_from_high_pct': round2(((high_52w - current_price) / high_52w) * 100),
                'distance_from_low_pct': round2(((current_price - low_52w) / low_52w) * 100),
            }
        else:
            conn2 = _get_conn(STOCKS_DB)
            c2 = conn2.cursor()
            c2.execute('SELECT current_price, high_52w, low_52w, volume, sector FROM stocks WHERE ticker = ?', (ticker_upper,))
            stock_row = c2.fetchone()
            conn2.close()
            if stock_row:
                context.time_context = {
                    'current_price': float(stock_row['current_price'] or 0),
                    'high_52w': float(stock_row['high_52w'] or 0),
                    'low_52w': float(stock_row['low_52w'] or 0),
                }
    except Exception as e:
        print(f"[MaestroHuman] Error in time context for {ticker}: {e}")
        context.time_context = {'error': str(e)}

    # 2. السياق القطاعي
    try:
        sector_name = ''
        conn = _get_conn(STOCKS_DB)
        cursor = conn.cursor()
        cursor.execute('SELECT sector FROM stocks WHERE ticker = ?', (ticker_upper,))
        stock_row = cursor.fetchone()
        if stock_row and stock_row['sector']:
            sector_name = stock_row['sector']
            conn2 = _get_conn(DATA_ENGINE_DB)
            c2 = conn2.cursor()
            c2.execute('SELECT ticker, perf_1w, perf_1m, perf_3m FROM tab_performance WHERE ticker = ? LIMIT 1', (ticker_upper,))  # PILLAR-2.5: tab_* uses ticker PK
            stock_perf = c2.fetchone()
            context.sector_context = {
                'sector_name': sector_name,
                'stock_perf_1w': parse_percentage(stock_perf['perf_1w']) if stock_perf else None,
                'stock_perf_1m': parse_percentage(stock_perf['perf_1m']) if stock_perf else None,
                'stock_perf_3m': parse_percentage(stock_perf['perf_3m']) if stock_perf else None,
            }
            conn2.close()
        conn.close()
    except Exception as e:
        print(f"[MaestroHuman] Error in sector context for {ticker}: {e}")
        context.sector_context = {'sector_name': '', 'error': str(e)}

    # 3. السياق السوقي
    try:
        conn = _get_conn(STOCKS_DB)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='market_indices'")
        has_table = cursor.fetchone()
        if has_table:
            cursor.execute('SELECT symbol, current_value, previous_close, change_percent FROM market_indices WHERE symbol = \'EGX30\' ORDER BY last_update DESC LIMIT 1')
            egx30 = cursor.fetchone()
            if egx30:
                egx30_change = float(egx30['change_percent'] or 0) if egx30['change_percent'] else 0
                regime_label = 'BULL' if egx30_change > 10 else 'BEAR' if egx30_change < -10 else 'SIDEWAYS'
                context.market_context = {
                    'regime': regime_label,
                    'egx30_change': egx30_change,
                    'egx30_value': float(egx30['current_value'] or 0),
                }
            else:
                context.market_context = {'regime': 'SIDEWAYS', 'egx30_change': None, 'egx30_value': None}
        else:
            context.market_context = {'regime': 'SIDEWAYS', 'egx30_change': None, 'egx30_value': None}
        conn.close()
    except Exception as e:
        print(f"[MaestroHuman] Error in market context for {ticker}: {e}")
        context.market_context = {'regime': 'SIDEWAYS', 'egx30_change': None, 'egx30_value': None}

    # 4. السياق التاريخي
    try:
        if context.time_context.get('current_price', 0) > 0:
            current_p = context.time_context['current_price']
            # PHASE 1 (v3.50.0): delegate to data.prices — single source of truth
            from data.prices import load_price_history
            # Original SQL: SELECT date, close_price FROM price_history
            #   WHERE ticker=? AND close_price BETWEEN ? AND ?
            #   AND date != (SELECT MAX(date) FROM price_history WHERE ticker=?)
            #   ORDER BY date DESC LIMIT 3
            # We replicate: fetch 365d, reverse to DESC, drop most-recent date,
            # filter by close in [current_p*0.95, current_p*1.05], take 3.
            _hist_raw = load_price_history(ticker_upper, limit=365)
            _hist_desc = list(reversed(_hist_raw))
            if _hist_desc:
                _most_recent_date = _hist_desc[0].get('date')
                _hist_desc = [h for h in _hist_desc if h.get('date') != _most_recent_date]
            _lo, _hi = current_p * 0.95, current_p * 1.05
            visits = [
                {'date': h.get('date'), 'close_price': h.get('close')}
                for h in _hist_desc
                if h.get('close') and _lo <= float(h['close']) <= _hi
            ][:3]
            if visits:
                visit_list = []
                for v in visits:
                    v_price = float(v['close_price'])
                    visit_list.append({
                        'date': v['date'],
                        'price': v_price,
                        'distance_from_current_pct': round2(((current_p - v_price) / v_price) * 100),
                    })
                context.historical_context = {'visits': visit_list, 'count': len(visits), 'current_price_zone': current_p}
            else:
                context.historical_context = {'visits': [], 'count': 0, 'note': 'غير متوفر'}
        else:
            context.historical_context = {'visits': [], 'count': 0, 'note': 'غير متوفر'}
    except Exception as e:
        print(f"[MaestroHuman] Error in historical context for {ticker}: {e}")
        context.historical_context = {'visits': [], 'count': 0, 'note': 'غير متوفر'}

    # 5. السياق السلوكي
    # P23-FILTER-HOTFIX: تخفيف فلتر السيولة القاسي.
    # قبل كده: لو volume_today=0 (بيانات اللحظي مش متحدثة) → liquidity_verdict='ضعيف، ابعد'
    # → الـ Frontend كان بيطرد السهم خالص ومش بيعرضه.
    # الحل: (1) لو volume_today=0/NULL، استخدم avg_volume_20d كـ fallback.
    #       (2) الـ verdict بقى أقل قسوة: 'ضعيف' (مش 'ضعيف، ابعد') عشان السهم يفضل معروض
    #           والـ Frontend يقدر يحط badge "سيولة ضعيفة" بدل ما يخبيه.
    try:
        # PHASE 1 (v3.50.0): delegate to data.prices — single source of truth
        from data.prices import load_price_history
        # load_price_history returns oldest-first + keys {volume, close, ...}.
        # Local code expects DESC (rows[0] = most recent) + close_price key.
        _vol_raw = load_price_history(ticker_upper, limit=21)
        volume_rows = [{
            'volume': r.get('volume'),
            'close_price': r.get('close'),
        } for r in reversed(_vol_raw)]
        if volume_rows and len(volume_rows) >= 2:
            raw_current_vol = parse_volume(volume_rows[0]['volume'])
            volumes = [parse_volume(r['volume']) for r in volume_rows[1:]]
            avg_vol = int(sum(volumes) / len(volumes)) if volumes else raw_current_vol

            # FALLBACK: لو volume_today = 0 (بيانات اللحظي مش متحدثة في الإنتاج)،
            # استخدم avg_volume_20d كقيمة تقديرية. ده بيمنع إن كل الأسهم تطلع
            # volume_today=0 → liquidity_verdict='ضعيف' → تختفي من التوصيات.
            current_vol = raw_current_vol if raw_current_vol and raw_current_vol > 0 else avg_vol

            # P7-VOLUME-FIX (v3.71.0): Safe division + unit-mismatch clamp (نفس
            # المنطق في run_volume_phase). لو price_history.volume في وحدة مختلفة
            # عن stocks.volume → vol_ratio بيطلع فلكي → liquidity_verdict غلط.
            if avg_vol > 0 and current_vol > 0:
                try:
                    vol_ratio = round2(current_vol / avg_vol)
                except (ZeroDivisionError, TypeError, ValueError):
                    vol_ratio = 1.0
                if vol_ratio > 50.0 or vol_ratio < 0.02:
                    print(f"[VOLUME_RATIO_CLAMP] {ticker_upper}: "
                          f"vol_ratio={vol_ratio} (cur={current_vol} "
                          f"avg_20d={avg_vol}) → clamped to 1.0 "
                          f"(unit mismatch suspected)")
                    vol_ratio = 1.0
            else:
                vol_ratio = 1.0

            # VERDDEX أقل قسوة: 'ضعيف' بدل 'ضعيف، ابعد' — السهم يفضل معروض.
            if vol_ratio > 1.5:
                liquidity_verdict = 'فيه اهتمام حقيقي'
            elif vol_ratio < 0.5:
                liquidity_verdict = 'سيولة ضعيفة — راقب'
            else:
                liquidity_verdict = 'عادي'

            context.behavioral_context = {
                'volume_today': current_vol,
                'avg_volume_20d': avg_vol,
                'volume_ratio': vol_ratio,
                'liquidity_verdict': liquidity_verdict,
                'volume_estimated': raw_current_vol == 0,  # flag للـ Frontend
            }
        else:
            context.behavioral_context = {'volume_today': 0, 'avg_volume_20d': 0, 'volume_ratio': 1.0, 'liquidity_verdict': 'عادي', 'note': 'غير متوفر'}
    except Exception as e:
        print(f"[MaestroHuman] Error in behavioral context for {ticker}: {e}")
        context.behavioral_context = {'volume_today': 0, 'avg_volume_20d': 0, 'volume_ratio': 1.0, 'liquidity_verdict': 'عادي'}

    return context


# ==================== MAESTRO HUMAN: CALCULATE PERSONAS ====================

def calculate_personas(ticker: str, context: MaestroHumanContext, stock: Dict = None) -> MaestroPersonas:
    personas = MaestroPersonas()
    ticker_upper = ticker.upper()
    tc = context.time_context or {}
    sc = context.sector_context or {}
    bc = context.behavioral_context or {}

    current_price = tc.get('current_price') or 0
    high_52w = tc.get('high_52w') or 0
    low_52w = tc.get('low_52w', 0)
    change_1m = tc.get('change_1m', 0)
    change_3m = tc.get('change_3m', 0)
    vol_ratio = bc.get('volume_ratio', 1.0)

    # Hunter
    hunter_score = 0
    hunter_conditions = []
    if high_52w > 0 and low_52w > 0 and current_price > 0:
        distance_from_low = ((current_price - low_52w) / low_52w) * 100
        if distance_from_low < 10:
            hunter_score += 35
            hunter_conditions.append(f'قرب القاع السنوي ({distance_from_low:.1f}% من القاع)')
        elif distance_from_low < 20:
            hunter_score += 20
            hunter_conditions.append(f'قريب من القاع السنوي ({distance_from_low:.1f}% من القاع)')
    if change_1m is not None and change_1m < -15:
        hunter_score += 30
        hunter_conditions.append(f'نزل {abs(change_1m):.1f}% في شهر')
    elif change_1m is not None and change_1m < -8:
        hunter_score += 15
        hunter_conditions.append(f'نزل {abs(change_1m):.1f}% في شهر')

    fair_value = None
    if FAIR_VALUE_AVAILABLE:
        try:
            fv_calc = FairValueCalculator(DATA_ENGINE_DB)
            fv_result = fv_calc.calculate(ticker, 'مصر')
            if fv_result and fv_result.fair_value and fv_result.fair_value > 0:
                fair_value = fv_result.fair_value
                upside = _safe_pct(fair_value, current_price) if current_price > 0 else 0
                if upside > 20:
                    hunter_score += 30
                    hunter_conditions.append(f'القيمة العادلة {fair_value:.1f} (فرصة {upside:.0f}%)')
                elif upside > 10:
                    hunter_score += 15
                    hunter_conditions.append(f'القيمة العادلة {fair_value:.1f} ({upside:.0f}%)')
        except Exception as e:
            logger.warning(f"Error in fair value calculation for {ticker}: {e}")

    if vol_ratio > 1.5:
        hunter_score += 20
        hunter_conditions.append(f'سيولة مرتفعة {vol_ratio:.1f}x المتوسط')
    elif vol_ratio > 1.0:
        hunter_score += 10

    stock_perf_1m = sc.get('stock_perf_1m')
    if stock_perf_1m is not None and change_1m is not None:
        if stock_perf_1m > change_1m + 10:
            hunter_score += 20
            hunter_conditions.append(f'السهم أضعف من القطاع بـ {abs(stock_perf_1m - change_1m):.1f}%')

    market_regime = context.market_context.get('regime', 'SIDEWAYS')
    if market_regime == 'BULL':
        hunter_score = min(95, hunter_score + 10)

    hunter_score = clamp(hunter_score, 0, 100)
    hunter_verdict = 'شراء قوي ✅' if hunter_score >= 70 else 'شراء' if hunter_score >= 50 else 'انتظار ⚠️' if hunter_score >= 30 else 'خطر ❌'
    hunter_reason = 'السهم في منطقة جيدة للصيادين — قرب قاع أو انخفاض واضح مع سيولة' if hunter_score >= 70 else 'السهم فيه بعض شروط الصياد لكن محتاج تأكيد أكثر' if hunter_score >= 50 else 'الظروف مش مواتية للصياد حالياً' if hunter_score >= 30 else 'السهم مش فرصة صياد — السعر مرتفع أو السيولة ضعيفة'

    personas.hunter = {
        'score': hunter_score, 'verdict': hunter_verdict, 'reason': hunter_reason,
        'conditions': hunter_conditions, 'fair_value': fair_value,
    }

    # Momentum
    momentum_score = 0
    momentum_conditions = []
    if change_1m is not None and change_1m > 15:
        momentum_score += 35
        momentum_conditions.append(f'زخم شهري قوي +{change_1m:.1f}%')
    elif change_1m is not None and change_1m > 8:
        momentum_score += 20
        momentum_conditions.append(f'زخم شهري +{change_1m:.1f}%')
    elif change_1m is not None and change_1m > 3:
        momentum_score += 10

    if change_3m is not None and change_3m > 20:
        momentum_score += 20
        momentum_conditions.append(f'زخم 3 شهور +{change_3m:.1f}%')

    if high_52w > 0 and current_price > 0:
        upside_room = _safe_pct(high_52w, current_price) if current_price > 0 else 0
        if upside_room > 30:
            momentum_score += 20
            momentum_conditions.append(f'بعيد عن القمة {upside_room:.0f}%')
        elif upside_room > 15:
            momentum_score += 10

    if vol_ratio > 1.5:
        momentum_score += 20
    elif vol_ratio > 1.0:
        momentum_score += 10
    else:
        momentum_score -= 10
        momentum_conditions.append('سيولة منخفضة')

    stock_perf_1w = sc.get('stock_perf_1w')
    if stock_perf_1w is not None and stock_perf_1w > 0:
        momentum_score += 10
        momentum_conditions.append(f'القطاع طالع {stock_perf_1w:.1f}%')
    elif stock_perf_1w is not None and stock_perf_1w < -5:
        momentum_score -= 15
        momentum_conditions.append(f'القطاع نازل {stock_perf_1w:.1f}%')

    momentum_score = clamp(momentum_score, 0, 100)
    momentum_verdict = 'زخم حقيقي ✅' if momentum_score >= 70 else 'زخم متوسط' if momentum_score >= 50 else 'انتظار ⚠️' if momentum_score >= 30 else 'خطر ❌'
    momentum_reason = 'السهم فيه زخم حقيقي — طالع بسرعة والسيولة بتأكده' if momentum_score >= 70 else 'السهم فيه زخم متوسط — ممكن يستمر' if momentum_score >= 50 else 'الزخم ضعيف — لازم تشوف إشارات أقوى' if momentum_score >= 30 else 'مفيش زخم — السهم راكد أو نازل ببطء'

    personas.momentum = {
        'score': momentum_score, 'verdict': momentum_verdict, 'reason': momentum_reason,
        'conditions': momentum_conditions,
    }

    # Value
    value_score = 0
    value_conditions = []
    if fair_value and fair_value > 0 and current_price > 0:
        upside = _safe_pct(fair_value, current_price) if current_price > 0 else 0
        if upside > 30:
            value_score += 40
            value_conditions.append(f'مقيم بأقل من قيمته {abs(upside):.0f}%')
        elif upside > 15:
            value_score += 25
            value_conditions.append(f'خصم {abs(upside):.0f}% عن القيمة العادلة')
        elif upside > 5:
            value_score += 10

    try:
        conn = _get_conn(DATA_ENGINE_DB)
        cursor = conn.cursor()
        cursor.execute('''
            SELECT v.pe_ratio, p.roe, p.roa, b.debt, b.total_equity
            FROM tab_valuation v
            LEFT JOIN tab_profitability p ON v.symbol = p.symbol
            LEFT JOIN tab_balance_sheet b ON v.symbol = b.symbol
            WHERE v.symbol = ? LIMIT 1
        ''', (ticker_upper,))
        val_row = cursor.fetchone()
        conn.close()

        if val_row:
            pe = parse_number(val_row['pe_ratio'])
            roe = parse_percentage(val_row['roe'])
            debt = parse_number(val_row['debt'])
            total_equity = parse_number(val_row['total_equity'])

            if pe and pe < 8:
                value_score += 20
                value_conditions.append(f'P/E منخفض ({pe:.1f})')
            elif pe and pe < 15:
                value_score += 10
                value_conditions.append(f'P/E معقول ({pe:.1f})')
            elif pe and pe > 25:
                value_score -= 10
                value_conditions.append(f'P/E مرتفع ({pe:.1f})')

            if roe and roe > 20:
                value_score += 20
                value_conditions.append(f'ROE ممتاز ({roe:.1f}%)')
            elif roe and roe > 15:
                value_score += 10
            elif roe and roe < 5:
                value_score -= 10
                value_conditions.append(f'ROE ضعيف ({roe:.1f}%)')

            if total_equity and total_equity > 0 and debt is not None:
                debt_ratio = debt / total_equity
                if debt_ratio < 0.5:
                    value_score += 15
                    value_conditions.append(f'ديون منخفضة (D/E {debt_ratio:.2f})')
                elif debt_ratio > 1.5:
                    value_score -= 15
                    value_conditions.append(f'ديون مرتفعة (D/E {debt_ratio:.2f})')
    except Exception as e:
        logger.warning(f"Error in value persona calculation: {e}")

    value_score = clamp(value_score, 0, 100)
    value_verdict = 'شراء قوي ✅' if value_score >= 70 else 'شراء' if value_score >= 50 else 'انتظار ⚠️' if value_score >= 30 else 'مقيم بأعلى من قيمته ❌'
    value_reason = 'السهم مقيم بأقل من قيمته بفرصة واضحة — P/E منخفض وارباح قوية' if value_score >= 70 else 'السهم فيه بعض مؤشرات القيمة لكن مش بالضرورة فرصة عاجلة' if value_score >= 50 else 'السهم مقيم غاليا أو الارباح مش مبررة السعر' if value_score >= 30 else 'السهم مبالغ في تقييمه — ابعد لحين تحسن المؤشرات'

    personas.value = {
        'score': value_score, 'verdict': value_verdict, 'reason': value_reason,
        'conditions': value_conditions, 'fair_value': fair_value,
    }

    return personas


# ==================== MAESTRO HUMAN: GENERATE NARRATIVE ====================

def generate_narrative(ticker: str, context: MaestroHumanContext, personas: MaestroPersonas, stock_name_ar: str = '') -> MaestroNarrative:
    narrative = MaestroNarrative()
    tc = context.time_context or {}
    sc = context.sector_context or {}
    mc = context.market_context or {}
    bc = context.behavioral_context or {}
    hc = context.historical_context or {}

    current_price = tc.get('current_price') or 0
    change_1m = tc.get('change_1m')
    distance_high = tc.get('distance_from_high_pct')
    distance_low = tc.get('distance_from_low_pct')
    sector_name = sc.get('sector_name', '')
    market_regime = mc.get('regime', 'SIDEWAYS')
    vol_ratio = bc.get('volume_ratio', 1.0)

    hunter_score = personas.hunter.get('score', 0)
    momentum_score = personas.momentum.get('score', 0)
    value_score = personas.value.get('score', 0)
    hunter_verdict = personas.hunter.get('verdict', '')
    momentum_verdict = personas.momentum.get('verdict', '')
    value_verdict = personas.value.get('verdict', '')
    hunter_reason = personas.hunter.get('reason', '')
    momentum_reason = personas.momentum.get('reason', '')
    value_reason = personas.value.get('reason', '')

    # LINE 1
    line1_parts = []
    if current_price > 0:
        if distance_high is not None and distance_high < 15:
            line1_parts.append(f"السهم قرب قمة السنة — السعر الحالي {current_price:.2f} (بعيد {distance_high:.0f}% عن القمة)")
        elif distance_high is not None and distance_high > 30:
            line1_parts.append(f"السهم بعيد {distance_high:.0f}% عن قمته السنوية — فرصة لو بقي تحت")
        else:
            line1_parts.append(f"السهم بسعر {current_price:.2f}")

        if change_1m is not None:
            if change_1m > 15:
                line1_parts.append(f"طالع {change_1m:.1f}% في آخر شهر — حركة قوية")
            elif change_1m < -15:
                line1_parts.append(f"نزل {abs(change_1m):.1f}% في شهر — السهم مكسور حالياً")
            elif change_1m < -8:
                line1_parts.append(f"نازل {abs(change_1m):.1f}% في الشهر ده")
    narrative.line1 = ' — '.join(line1_parts) if line1_parts else f'مفيش بيانات كافية لـ {ticker}'

    # LINE 2
    line2_parts = []
    if sector_name:
        line2_parts.append(f"القطاع: {sector_name}")
    if market_regime == 'BULL':
        line2_parts.append("والسوق صاعد")
    elif market_regime == 'BEAR':
        line2_parts.append("والسوق هابط — احذر")
    else:
        line2_parts.append("والسوق عرضي — مفيش اتجاه واضح")
    if vol_ratio > 1.5:
        line2_parts.append(f"السيولة مرتفعة ({vol_ratio:.1f}x)")
    elif vol_ratio < 0.5:
        line2_parts.append("السيولة ضعيفة — ابعد")
    narrative.line2 = ' — '.join(line2_parts) if line2_parts else 'سياق غير متوفر'

    # LINE 3
    line3_parts = []
    if hunter_score >= 70:
        line3_parts.append(f"الصياد: {hunter_verdict}. {hunter_reason}")
    if momentum_score >= 70:
        line3_parts.append(f"الزخم: {momentum_verdict}. {momentum_reason}")
    if value_score >= 70:
        line3_parts.append(f"القيمة: {value_verdict}. {value_reason}")

    if distance_high is not None and distance_high < 5:
        line3_parts.append("احذر: وصول قمة السنة بسرعة دي معناه ربح جامد عايز يخرج")
    elif distance_low is not None and distance_low < 10:
        line3_parts.append("فرصة محتملة لو ثبت تحت مع سيولة")
    narrative.line3 = ' | '.join(line3_parts) if line3_parts else 'توقع غير متوفر — بيانات غير كافية.'

    return narrative


def generate_persona_narrative(
    ticker: str,
    stock: Dict,
    human_context: MaestroHumanContext,
    gambler: Optional[Dict[str, Any]] = None,
    investor: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    """
    توليد narrative مخصص للـ Unified Persona Engine (gambler + investor).
    3 سطور بالعربى العامي.
    """
    tc = (human_context.time_context if human_context else {}) or {}
    sc = (human_context.sector_context if human_context else {}) or {}
    mc = (human_context.market_context if human_context else {}) or {}

    current_price = float(stock.get('current_price') or tc.get('current_price') or 0)
    change_1d = float(stock.get('change_percent') or 0)
    change_1m = tc.get('change_1m')
    change_1w = tc.get('change_1w')
    sector_name = sc.get('sector_name', '') or stock.get('sector', '')
    market_regime = mc.get('regime', 'SIDEWAYS')
    stock_perf_1w = sc.get('stock_perf_1w')
    name_ar = stock.get('name_ar', '') or stock.get('name', '') or ticker

    # LINE 1: السعر + حركة اليوم/الشهر
    line1_parts = []
    if current_price > 0:
        line1_parts.append(f"{name_ar} بسعر {current_price:.2f}")
        if change_1d != 0:
            sign = 'طالع' if change_1d > 0 else 'نازل'
            line1_parts.append(f"({sign} {abs(change_1d):.1f}% النهاردة)")
        elif change_1m is not None and change_1m != 0:
            sign = 'طالع' if change_1m > 0 else 'نازل'
            line1_parts.append(f"({sign} {abs(change_1m):.1f}% في الشهر)")
    else:
        line1_parts.append(f"مفيش بيانات سعر لـ {ticker}")

    # LINE 2: القطاع + السوق + مقارنة الأداء
    line2_parts = []
    if sector_name:
        line2_parts.append(f"قطاع {sector_name}")
    if market_regime == 'BULL':
        line2_parts.append("والسوق صاعد")
    elif market_regime == 'BEAR':
        line2_parts.append("والسوق نازل")
    else:
        line2_parts.append("والسوق عرضي")
    if stock_perf_1w is not None and change_1w is not None:
        diff = stock_perf_1w - change_1w
        if abs(diff) > 3:
            if diff > 0:
                line2_parts.append(f"السهم أضعف من القطاع بـ {abs(diff):.1f}%")
            else:
                line2_parts.append(f"السهم أقوى من القطاع بـ {abs(diff):.1f}%")

    # LINE 3: قرارات الـ personas
    line3_parts = []
    if gambler:
        line3_parts.append(f"🎰 المغامر: {gambler.get('verdict', '')} (سكور {gambler.get('score', 0):.0f})")
    if investor:
        line3_parts.append(f"🏦 المستثمر: {investor.get('verdict', '')} (سكور {investor.get('score', 0):.0f})")

    return {
        'line1': ' — '.join(line1_parts),
        'line2': ' — '.join(line2_parts) if line2_parts else 'سياق غير متوفر',
        'line3': ' | '.join(line3_parts) if line3_parts else 'توقعات غير متوفرة',
    }


def calculate_support_resistance(closes: List[float], period: int = 20) -> Dict[str, float]:
    if len(closes) < period:
        period = len(closes)
    if period < 5:
        return {'support': closes[-1] * 0.95, 'resistance': closes[-1] * 1.05, 'range_pct': 10.0}
    recent_closes = closes[-period:]
    support = min(recent_closes)
    resistance = max(recent_closes)
    current_price = closes[-1]
    position_pct = ((current_price - support) / (resistance - support)) * 100 if resistance != support else 50.0
    return {
        'support': round2(support), 'resistance': round2(resistance), 'current_price': round2(current_price),
        'position_pct': round2(position_pct), 'range_pct': round2(((resistance - support) / support) * 100) if support > 0 else 10.0,
        'distance_to_support_pct': round2(_safe_pct(current_price, support)) if support > 0 else 50.0,
        'distance_to_resistance_pct': round2(_safe_pct(resistance, current_price)) if current_price > 0 else 50.0
    }


def get_price_position_label(position_pct: float) -> str:
    if position_pct <= 10:
        return 'at_support'
    elif position_pct >= 90:
        return 'at_resistance'
    elif position_pct <= 30:
        return 'near_support'
    elif position_pct >= 70:
        return 'near_resistance'
    else:
        return 'mid_range'


# ==================== PHASE 1: REGIME DETECTION ====================

def run_regime_phase(closes: List[float], force_regime: str = None) -> RegimePhaseResult:
    signals = []
    if force_regime:
        return RegimePhaseResult(phase=force_regime, confidence=0.95, score=80 if force_regime == 'bull' else 25 if force_regime == 'bear' else 50, signals=[f'حالة السوق محددة يدوياً: {force_regime}'])
    if len(closes) < 20:
        return RegimePhaseResult(phase='range', confidence=0.5, score=50, signals=['بيانات غير كافية'])
    sr = calculate_support_resistance(closes, 20)
    position_label = get_price_position_label(sr['position_pct'])
    if position_label == 'at_support':
        phase, confidence, score = 'bull', 0.80, 75
        signals.append(f'السعر عند الدعم ({sr["support"]:.2f}) - فرصة شراء')
    elif position_label == 'at_resistance':
        phase, confidence, score = 'bear', 0.75, 30
        signals.append(f'السعر عند المقاومة ({sr["resistance"]:.2f}) - انتظر')
    elif position_label == 'near_support':
        phase, confidence, score = 'bull', 0.70, 65
        signals.append(f'السعر قرب الدعم ({sr["support"]:.2f}) - فرصة جيدة')
    elif position_label == 'near_resistance':
        phase, confidence, score = 'range', 0.60, 45
        signals.append(f'السعر قرب المقاومة ({sr["resistance"]:.2f}) - حذر')
    else:
        phase, confidence, score = 'range', 0.50, 50
        signals.append(f'السعر في منتصف النطاق')

    # ── P4-REGIME-FIX: Macro Regime Override من MarketRegimeEngine ──────────
    # لو الـ EGX30 في Stage 4 (Bear Market)، لازم نـ override الـ stock-level
    # regime لـ bear — مش معقول نشتري سهم قرب دعمه لو السوق كله بينزل.
    # لو Stage 2 (Bull)، بنـ boost الـ confidence بس مش نـ override.
    try:
        from engines.market_regime import MarketRegimeEngine
        _macro_engine = MarketRegimeEngine()
        _macro = _macro_engine.get_regime()
        _macro_stage = _macro.stage  # 1=Consolidation, 2=Bull, 3=Distribution, 4=Bear
        _macro_name = _macro.stage_name

        if _macro_stage == 4:
            # EGX30 in Bear Market → override to bear regardless of stock position
            phase = 'bear'
            confidence = max(confidence, 0.80)
            score = min(score, 25)
            signals.append(f'[VETO:bear_market] EGX30 Stage 4 ({_macro_name}) — override to bear')
        elif _macro_stage == 2 and phase != 'bear':
            # EGX30 in Bull Market → boost confidence if stock agrees
            if phase == 'bull':
                confidence = min(1.0, confidence + 0.10)
                score = min(100, score + 10)
                signals.append(f'[REGIME:bull_boost] EGX30 Stage 2 ({_macro_name}) — bull confidence boosted')
            else:
                signals.append(f'[REGIME:macro_bull] EGX30 Stage 2 ({_macro_name}) — stock neutral but market bull')
        elif _macro_stage == 3:
            # Distribution → cautious, don't override but lower confidence
            confidence = max(0.3, confidence - 0.10)
            signals.append(f'[REGIME:distribution] EGX30 Stage 3 ({_macro_name}) — distribution, lower confidence')
    except Exception as _mre:
        # MarketRegimeEngine unavailable (EGX30 data missing, etc.) → use stock-level only
        signals.append(f'[REGIME:macro_unavailable] MarketRegimeEngine fallback: {_mre}')

    return RegimePhaseResult(phase='bear_trend' if phase == 'bear' and confidence >= 0.75 else phase, confidence=confidence, score=score, signals=signals, sma_alignment=position_label, roc_value=sr['position_pct'])


# ==================== PHASE 2: TIMEFRAME CONFLUENCE ====================

def run_timeframe_phase(ticker: str, price_history: List[Dict]) -> TimeframePhaseResult:
    signals = []
    analysis = analyze_timeframes(ticker, price_history)
    confluence_score = analysis.confluence.score
    aligned = analysis.confluence.aligned
    aligned_count = analysis.confluence.aligned_count
    daily_trend_ar = {'bullish': 'صاعد', 'bearish': 'هابط', 'neutral': 'محايد'}.get(analysis.daily.trend, 'محايد')
    if aligned and aligned_count >= 2:
        signals.append(f'تقارب قوي: {aligned_count} أطر زمنية متوافقة ({daily_trend_ar})')
    elif aligned_count >= 1:
        signals.append(f'تقارب جزئي: {aligned_count} أطر زمنية متوافقة')
    else:
        signals.append('لا يوجد تقارب واضح')
    signals.extend(analysis.daily.signals[:2])
    return TimeframePhaseResult(confluence_score=confluence_score, aligned=aligned, aligned_count=aligned_count, daily_trend=daily_trend_ar, signals=signals, details={'daily': {'trend': analysis.daily.trend, 'score': analysis.daily.score}, 'weekly': {'trend': analysis.weekly.trend, 'score': analysis.weekly.score}, 'monthly': {'trend': analysis.monthly.trend, 'score': analysis.monthly.score}})


# ==================== PHASE 3: VOLUME CONTEXT ====================

def run_volume_phase(stock: Dict, price_history: List[Dict]) -> VolumePhaseResult:
    signals = []
    current_volume = parse_volume(stock.get('volume', 0))
    current_price = to_num(stock.get('current_price', 0))
    volumes = [parse_volume(p.get('volume', 0)) for p in price_history[-20:] if parse_volume(p.get('volume', 0)) > 0]
    avg_volume_20 = int(sum(volumes) / len(volumes)) if volumes else current_volume
    # ── P7-VOLUME-FIX (v3.71.0): Safe division + unit-mismatch clamp ──────────
    # ROOT CAUSE (اللي خلّى vol_ratio=155008.53 في اللوجز + بوابة المضارب ترفض):
    # stocks.volume (real, e.g. 1.5M shares) و price_history.volume (placeholder
    # صغير e.g. 1) في وحدات مختلفة. لما avg_volume_20 بيطلع 1 و current_volume
    # بيطلع 1.5M → volume_ratio = 1.5M / 1 = 155008.53 (خرافي). ده بيخلي:
    #   - بوابة المضارب بترفض (شرط 1.5<=vr<=50 بي fail)
    #   - بوابة المتوازن بتقبل غلط (شرط vr>=1.2 بي true بشكل وهمي)
    #   - compute_gambler_rank_score بي cap عند 50 بس اللوج بيظهر الرقم الفلكي
    # الحل: لو الـ ratio خارج نطاق [0.02, 50] → ده unit mismatch واضح →
    # نرجّع 1.0 (متوسط) + لوج واضح للـ diagnostics.
    if avg_volume_20 > 0 and current_volume > 0:
        try:
            volume_ratio = round2(current_volume / avg_volume_20)
        except (ZeroDivisionError, TypeError, ValueError):
            volume_ratio = 1.0
        # Unit-mismatch detection: ratio فوق 50x أو تحت 0.02x = وحدات مختلفة
        # (مش إشارة سيولة حقيقية). نرجّع 1.0 عشان البوابات ما ترفضش ولا تقبل غلط.
        if volume_ratio > 50.0 or volume_ratio < 0.02:
            print(f"[VOLUME_RATIO_CLAMP] {stock.get('ticker', '?')}: "
                  f"vol_ratio={volume_ratio} (cur_vol={current_volume} "
                  f"avg_vol_20={avg_volume_20}) → clamped to 1.0 "
                  f"(unit mismatch suspected)")
            volume_ratio = 1.0
    else:
        # avg_volume_20 = 0 (price_history فاضي/بيانات ناقصة) أو current_volume = 0
        # → مش إشارة سيولة، نرجّع 1.0 (متوسط) بدل ما الكود يـ crash أو يرفض.
        volume_ratio = 1.0
    avg_value_traded = avg_volume_20 * current_price
    if avg_value_traded >= 10_000_000:
        liquidity_rating = 'high'
        signals.append(f'سيولة عالية ({avg_value_traded / 1_000_000:.1f} مليون جنيه يومياً)')
    elif avg_value_traded >= 2_000_000:
        liquidity_rating = 'medium'
        signals.append(f'سيولة متوسطة ({avg_value_traded / 1_000_000:.1f} مليون جنيه يومياً)')
    else:
        liquidity_rating = 'low'
        signals.append(f'⚠️ سيولة منخفضة ({avg_value_traded / 1_000_000:.1f} مليون جنيه يومياً)')
    if volume_ratio > 1.2:
        signals.append(f'حجم التداول مرتفع {volume_ratio}x المتوسط')
    elif volume_ratio < 0.7:
        signals.append(f'حجم التداول منخفض {volume_ratio}x المتوسط')
    return VolumePhaseResult(liquidity_rating=liquidity_rating, volume_ratio=volume_ratio, volume_above_avg=volume_ratio > 1.2, signals=signals, current_volume=current_volume, avg_volume_20=avg_volume_20, avg_value_traded=avg_value_traded)


# ==================== PHASE 4: NEWS CONTEXT ====================

def run_news_phase(ticker: str, db_path: str) -> NewsPhaseResult:
    signals = []
    try:
        result = check_news_stop_filter(ticker, db_path, 1)
        if result.has_cbe_news:
            signals.append('⚠️ قرار بنك مركزي في آخر 24 ساعة')
            signals.append(result.reason_ar)
        elif result.has_news:
            signals.append(f'📰 {result.news_count} خبر في آخر 24 ساعة')
            signals.append(result.reason_ar)
        else:
            signals.append('لا توجد أخبار حديثة')
        return NewsPhaseResult(has_news=result.has_news, has_cbe_news=result.has_cbe_news, should_hold=result.should_hold, risk_level=result.risk_level, signals=signals, news_count=result.news_count)
    except Exception as e:
        return NewsPhaseResult(has_news=False, has_cbe_news=False, should_hold=False, risk_level='low', signals=['لا توجد أخبار متاحة'])


# ==================== PHASE 5: MAESTRO SCORE ====================

def calculate_maestro_score(regime_phase: RegimePhaseResult, timeframe_phase: TimeframePhaseResult, volume_phase: VolumePhaseResult, news_phase: NewsPhaseResult, quality_score: float, technical_score: float, closes: List[float] = None) -> float:
    regime = regime_phase.phase
    _mapped_regime = regime
    if _mapped_regime in ('bear_trend', 'strong_bear'): _mapped_regime = 'bear'
    elif _mapped_regime in ('bull_trend', 'strong_bull', 'momentum'): _mapped_regime = 'bull'
    elif _mapped_regime in ('ranging', 'sideways'): _mapped_regime = 'range'
    
    if _mapped_regime not in REGIME_WEIGHTS:
        _mapped_regime = 'unknown' if 'unknown' in REGIME_WEIGHTS else 'range'
    
    weights = dict(REGIME_WEIGHTS[_mapped_regime])
    
    # P24-ADAPTIVE-MAESTRO: تطبيق أوزان تكييفية من adaptive_weights.py
    # لو الـ module متاح، بنعمل overlay على الأوزان بناءً على السيولة والتذبذب
    if ADAPTIVE_WEIGHTS_AVAILABLE:
        try:
            liq_score = 1.0
            if volume_phase.liquidity_rating == 'low':
                liq_score = 0.2
            elif volume_phase.liquidity_rating == 'medium':
                liq_score = 0.6
            elif volume_phase.liquidity_rating == 'high':
                liq_score = 1.0
            aw = get_adaptive_weights(_mapped_regime, volatility_regime='normal', liquidity_score=liq_score)
            # remap: technical_weight → technical, volume_profile → volume, smc → support_resistance
            _tech_boost = aw.get('technical', 0.15) / 0.15  # normalize vs base
            _vol_boost = aw.get('volume_profile', 0.05) / 0.05
            _sr_boost = aw.get('smc', 0.26) / 0.26
            # Apply as gentle adjustments (max ±30% change)
            weights['technical'] = weights['technical'] * max(0.7, min(1.3, _tech_boost))
            weights['volume'] = weights['volume'] * max(0.7, min(1.3, _vol_boost))
            weights['support_resistance'] = weights['support_resistance'] * max(0.7, min(1.3, _sr_boost))
            # Re-normalize to sum = 1.0
            _total = sum(weights.values())
            if _total > 0:
                weights = {k: v / _total for k, v in weights.items()}
        except Exception:
            pass  # Fall back to REGIME_WEIGHTS if adaptive fails
    
    sr_score = 50.0
    if closes and len(closes) >= 20:
        sr = calculate_support_resistance(closes, 20)
        position_pct = sr['position_pct']
        if position_pct <= 10:
            sr_score = 95
        elif position_pct <= 30:
            sr_score = 80
        elif position_pct <= 70:
            sr_score = 50
        elif position_pct <= 90:
            sr_score = 30
        else:
            sr_score = 10
    volume_score = 50.0
    volume_ratio = volume_phase.volume_ratio
    if volume_ratio >= 2.0:
        volume_score = 100
    elif volume_ratio >= 1.5:
        volume_score = 85
    elif volume_ratio >= 1.0:
        volume_score = 60
    elif volume_ratio >= 0.5:
        volume_score = 40
    else:
        volume_score = 20
    maestro_score = sr_score * weights['support_resistance'] + volume_score * weights['volume'] + technical_score * weights['technical']
    if news_phase.risk_level == 'high':
        maestro_score *= 0.85
    if volume_phase.liquidity_rating == 'low':
        maestro_score *= 0.90
    return clamp(round2(maestro_score), 0, 100)


def determine_recommendation(maestro_score: float, regime: str, volume_ratio: float = 1.0, price_position: str = 'mid_range', distance_to_support_pct: float = 50.0, persona_type: str = 'balanced', stock_profile: dict = None, threshold_boost: float = 0.0) -> tuple:
    """حساب التوصية النهائية مع تدرّج القيود حسب الـ persona_type + DNA.

    P21-PERSONA-CONSTRAINTS (Aug 2026):
    - conservative (المحافظ): عتبات أعلى — ما يشتري غير الفرص الواضحة جداً،
      ويحترم Veto السوق الهابط/قرب المقاومة. يفضّل HOLD لو مفيش فرصة واضحة.
    - balanced (المتوازن): عتبات وسطى — لو master_score > 45 يبقى ACCUMULATE/BUY.
    - gambler (المضارب): عتبات منخفضة جداً — يدخل على الزخم اللحظي والـ Volume Spike،
      BUY لو master_score > 35. ما عليهوش Veto نهائياً.

    P40-DNA-WIRING + Axis A (DNA & Market Sync Fix):
    - stock_profile: ملف السهم من stock_personality (P40)
    - threshold_boost: قيمة سالبة من stock_adaptive_profiles (Axis A)
      بتمثل "هل السهم حيّ؟" — لو حيّ، العتبات تنزل أكتر.

    Returns: (recommendation, recommendation_ar)
    """
    # ── T+1 / Swing BUY shortcuts (مش personas-dependent) ──
    if distance_to_support_pct <= 4.0 and volume_ratio >= 1.2:
        return 't1_buy', 'شراء T+1'
    if price_position == 'at_support' and volume_ratio >= 1.5:
        return 't1_buy', 'شراء T+1'
    if price_position in ['at_support', 'near_support'] and volume_ratio >= 1.0 and maestro_score >= 55:
        return 'swing_buy', 'شراء متأرجح'

    # ── UNIFIED-BALANCED-ONLY (2026-08-30): تعطيل تعدد الشخصيات ──
    # المنطق الموحد المطلوب من المالك: "ألغي تعدد الشخصيات تمامًا. خلي النظام
    # يشتغل بأسلوب المتوازن (Balanced) فقط كأساس وحيد."
    #
    # التغيير: مهما كان persona_type المُمرّر (gambler/conservative/investor/...),
    # النظام بـ يستخدم thresholds الـ balanced فقط. الكود القديم لكل persona
    # اتعلّق (مش اتمسح) عشان لو المالك رجع للشخصيات تاني، بس دلوقتي ما بيأثرش
    # على القرارات. الـ persona_type بـ يـ log بس للـ audit.
    #
    # الـ thresholds الـ balanced (من P0-v13-OPPORTUNITY):
    #   - bull:   strong_buy=55, buy=42, hold=30, sell=20
    #   - bear:   strong_buy=58, buy=45, hold=32, sell=22
    #   - range:  strong_buy=52, buy=40, hold=28, sell=18
    # الترتيب: (strong_buy, buy, hold, sell) — strong_sell = أي شيء أقل من sell
    _persona = (persona_type or 'balanced').lower().strip()
    # ── legacy persona thresholds (معطّلة — مش بـ تـ affect القرار) ──
    # محتفظين بالكود للـ audit لو المالك رجع للشخصيات تاني.
    # if _persona in ('gambler', 'active_trader'):
    #     thresholds = (45, 28, 18, 12) if regime == 'bull' else \
    #                  (50, 32, 22, 15) if regime == 'bear' else \
    #                  (42, 25, 16, 10)  # range/sideways
    # elif _persona in ('conservative', 'investor'):
    #     thresholds = (62, 50, 38, 28) if regime == 'bull' else \
    #                  (68, 55, 42, 32) if regime == 'bear' else \
    #                  (58, 48, 36, 26)  # range/sideways
    # else:
    #     thresholds = (55, 42, 30, 20) if regime == 'bull' else \
    #                  (58, 45, 32, 22) if regime == 'bear' else \
    #                  (52, 40, 28, 18)  # range/sideways

    # المتوازن هو الأساس الوحيد (UNIFIED-BALANCED-ONLY):
    thresholds = (55, 42, 30, 20) if regime == 'bull' else \
                 (58, 45, 32, 22) if regime == 'bear' else \
                 (52, 40, 28, 18)  # range/sideways

    # ── P40-DNA-WIRING + P0-v7 TASK #2 (DNA-DRIVEN THRESHOLDS): ──────────
    # الـ DNA بيقول للعقل: "ده سهم متقلب/قوي → خفّف العتبات عشان يقدر يطلع BUY".
    # 🔥 P0-v7: المالك اشتكى إن الـ DNA discount القديم كان ضعيف جداً (amplifier=-8
    #    بس) → السهم المتفجر بـ يفضل محروم من BUY لأن العتبة (-8) مش كافية.
    #    المالك طلب: "Threshold Boost حقيقي يخفض عتبة الشراء لها ليقنصها السيستم
    #    فوراً قبل أن تطير". الحل: رفعنا الـ discounts بـ 2x+ وأضفنا بوابتين
    #    جديدتين (momentum_sniper + volume_spike_freq) عشان الأسهم اللي بتعمل
    #    +50%/+100% تـ qualifying لـ BUY فوراً قبل ما تطير.
    _dna_discount = 0
    if stock_profile and isinstance(stock_profile, dict):
        try:
            _crash = str(stock_profile.get('reaction_to_market_crashes') or '').lower().strip()
            _vol_pct = float(stock_profile.get('volatility_percentile_90d') or 0)
            _pers = str(stock_profile.get('personality_type_en') or '').lower().strip()
        except (TypeError, ValueError):
            _crash = _vol_pct = _pers = ''

        # حاول نقرأ momentum_score + volume_spike_freq من الـ DNA (لو متاحين)
        try:
            _mom_score = float(stock_profile.get('momentum_score') or 0)
        except (TypeError, ValueError):
            _mom_score = 0.0
        try:
            _vsp_freq = float(stock_profile.get('volume_spike_freq') or 0)
        except (TypeError, ValueError):
            _vsp_freq = 0.0

        if _crash == 'amplifier':
            # amplifier: سهم بيتحرك بقوة في الأزمات → -15 (كان -8)
            _dna_discount = 15
        elif _vol_pct > 75:
            # متقلب جداً الآن → -12 (كان -6)
            _dna_discount = 12
        elif _pers in ('speculative_bull', 'speculative_volatile'):
            # شخصية مضاربية → -10 (كان -5)
            _dna_discount = 10

        # 🔥 P0-v7 بوابتان جديدتان للأسهم المتفجرة:
        if _mom_score >= 80:
            # momentum_sniper: السهم فيه زخم عالي جداً → -15 إضافي (snipe قبل ما يطير)
            _dna_discount = max(_dna_discount, 15)
        if _vsp_freq >= 0.4:
            # volume_spike_freq ≥ 0.4 (40% من الأيام فيها volume spike) → -10
            _dna_discount = max(_dna_discount, 10)

    if _dna_discount > 0:
        # خفّض كل العتبات (strong_buy, buy, hold, sell) بنفس القيمة،
        # بس متخليش العتبة تنزل تحت 15 (حد أدنى منطقي).
        thresholds = tuple(max(15, t - _dna_discount) for t in thresholds)

    # ── Axis A (DNA & Market Sync Fix): threshold_boost من stock_adaptive_profiles ──
    # الـ threshold_boost قيمة سالبة (مثلاً -8) بتخفض كل العتبات عشان السهم
    # "الحيّ" (alive — amplifier/volume_spike/momentum عالي) يطلع BUY signals.
    # ده بيكمّل الـ P40 stock_profile discount — الاتنين بيتطبقوا بالترتيب.
    if threshold_boost != 0:
        thresholds = tuple(max(15, t + threshold_boost) for t in thresholds)

    if maestro_score >= thresholds[0]:
        return 'strong_buy', 'شراء قوي'
    elif maestro_score >= thresholds[1]:
        return 'buy', 'شراء'
    elif maestro_score >= thresholds[2]:
        return 'hold', 'احتفاظ'
    elif maestro_score >= thresholds[3]:
        return 'sell', 'بيع'
    else:
        return 'strong_sell', 'بيع قوي'


def apply_position_override(
    recommendation: str,
    recommendation_ar: str,
    user_position: Optional[dict] = None,
) -> tuple:
    """يطبّق take-profit / stop-loss override على توصية الـ Maestro.

    يحلّ المشكلة الجذرية: «السهم اللي طلع كتير = شراء» بدل «بيع لأنك كسبت».

    Args:
        recommendation: التوصية الأصلية من determine_recommendation
        recommendation_ar: التوصية بالعربي
        user_position: dict اختياري فيه:
            - purchase_price: float (سعر الشراء)
            - current_price: float (السعر الحالي)
            - quantity: float (العدد)
            - rsi: float (اختياري — RSI الحالي)

    Returns:
        (recommendation, recommendation_ar) — إما override أو الأصلية

    Override rules (لو user_position موجود):
        - pnl_pct <= -8%  → 'stop_loss',  '🚨 إيقاف خسارة — بِع فوراً'
        - pnl_pct >= +15% → 'take_profit','✅ جني أرباح — بِع جزء'
        - rsi > 70 و pnl_pct > 5% → 'sell', '📤 بيع — تشبع شرائي + ربح'
        - rsi > 75 و pnl_pct > 0% → 'sell', '📤 بيع وقائي — تشبع قصوي'
    """
    if not user_position:
        return recommendation, recommendation_ar

    try:
        purchase = float(user_position.get('purchase_price') or 0)
        current = float(user_position.get('current_price') or 0)
        rsi = float(user_position.get('rsi') or 50)

        if purchase <= 0 or current <= 0:
            return recommendation, recommendation_ar

        pnl_pct = ((current - purchase) / purchase) * 100.0

        # وقف خسارة — أهم override
        if pnl_pct <= -8.0:
            return 'stop_loss', f'🚨 إيقاف خسارة — بِع فوراً (خسارة {pnl_pct:.1f}%)'

        # جني أرباح
        if pnl_pct >= 15.0:
            return 'take_profit', f'✅ جني أرباح — بِع جزء (ربح {pnl_pct:.1f}%)'

        # بيع عند تشبع شرائي + ربح
        if rsi > 70 and pnl_pct > 5.0:
            return 'sell', f'📤 بيع — تشبع شرائي (RSI {rsi:.0f}) + ربح {pnl_pct:.1f}%'

        # بيع وقائي عند تشبع قصوي حتى لو ربح صغير
        if rsi > 75 and pnl_pct > 0:
            return 'sell', f'📤 بيع وقائي — تشبع قصوي (RSI {rsi:.0f})'

        return recommendation, recommendation_ar
    except (ValueError, TypeError, ZeroDivisionError):
        return recommendation, recommendation_ar


# ==================== PHASE 6: EXPERT MEMORY (Closed-Loop B2) ====================

def run_expert_memory_phase(db_path: str, ticker: str, sector: str, regime: str, rsi: float, month: int, personality: str = None, persona_name: str = 'balanced') -> ExpertMemoryResult:
    """B2 (Closed-Loop) — اقرأ الدروس الحقيقية من learned_lessons واتخذ قرار.

    قبل كده كانت الدالة دي STUB بـ ترجّع 'proceed' دائماً → التعلم مكسور.
    دلوقتي بـ تقرأ:
      1. ملخص دروس الشخصية (persona_name) في آخر 30 يوم.
      2. ملخص دروس السهم (ticker) في آخر 90 يوم.
    وبـ تتخذ قرار محصور (bounded):
      - win_rate < 0.35 و total >= 3  → 'caution' (قلّل الثقة)
      - win_rate >= 0.65 و total >= 3 → 'boost'   (عزّز الثقة)
      - ticker فيه STOP_TOO_TIGHT >= 2 → 'caution'
      - غير كده → 'proceed'

    لو مفيش دروس → 'proceed' مع سبب صادق (مش "disabled" كاذب).
    """
    try:
        from utils.lesson_store import get_persona_lesson_summary, get_ticker_lesson_summary
    except ImportError:
        return ExpertMemoryResult(
            found_similar=False, total_similar=0, win_rate=0.5, avg_pnl=0,
            confidence_adjustment=0, recommendation='proceed',
            reason='lesson_store غير متاح', pattern_type='none',
        )

    try:
        persona_summ = get_persona_lesson_summary(persona_name, days=30)
        ticker_summ = get_ticker_lesson_summary(ticker, days=90)

        p_total = persona_summ.get('total', 0)
        t_total = ticker_summ.get('total', 0)
        total_similar = p_total + t_total

        # لو مفيش دروس أصلاً → proceed بصدق
        if total_similar == 0:
            return ExpertMemoryResult(
                found_similar=False, total_similar=0, win_rate=0.5, avg_pnl=0,
                confidence_adjustment=0, recommendation='proceed',
                reason='لا توجد دروس بعد — النظام لسه بـ يجمع البيانات',
                pattern_type='none',
            )

        win_rate = persona_summ.get('win_rate', 0.0)
        avg_pnl = persona_summ.get('avg_return', 0.0)

        # تحديد recommendation بناءً على الأداء
        recommendation = 'proceed'
        confidence_adjustment = 0.0
        reason_parts = []
        pattern_type = 'persona_history'

        # قاعدة 1: أداء الشخصية ضعيف
        if p_total >= 3 and win_rate < 0.35:
            recommendation = 'caution'
            confidence_adjustment = -min(10, (0.35 - win_rate) * 30)
            reason_parts.append(
                f"شخصية {persona_name}: {p_total} صفقة، نسبة نجاح {win_rate:.0%} (< 35%)"
            )
        # قاعدة 2: أداء الشخصية قوي
        elif p_total >= 3 and win_rate >= 0.65:
            recommendation = 'boost'
            confidence_adjustment = min(8, (win_rate - 0.65) * 25)
            reason_parts.append(
                f"شخصية {persona_name}: {p_total} صفقة، نسبة نجاح {win_rate:.0%} (≥ 65%)"
            )

        # قاعدة 3: السهم فيه STOP_TOO_TIGHT متكرر
        stt = ticker_summ.get('by_code', {}).get('STOP_TOO_TIGHT', {}).get('count', 0)
        if stt >= 2:
            if recommendation == 'proceed':
                recommendation = 'caution'
            confidence_adjustment = min(0, confidence_adjustment) - min(5, stt * 2)
            reason_parts.append(f"السهم {ticker}: وقف ضيق {stt}×")
            pattern_type = 'stop_too_tight'

        # قاعدة 4: السهم فيه LATE_MOMENTUM متكرر
        lm = ticker_summ.get('by_code', {}).get('LATE_MOMENTUM', {}).get('count', 0)
        if lm >= 2:
            if recommendation == 'proceed':
                recommendation = 'caution'
            confidence_adjustment = min(0, confidence_adjustment) - min(5, lm * 2)
            reason_parts.append(f"السهم {ticker}: دخول متأخر {lm}×")
            pattern_type = 'late_momentum'

        # ── P0-v7 TASK #4 (CLOSED-LOOP): قاعدة 5 — MISSED_BREAKOUT تعويض ────
        # لو السهم اتسجّل عليه MISSED_BREAKOUT ≥ 2 (اتحرك بقوة من غير توصية شراء
        # من السيستم) → النظام "بيتعوّض" بـ boost الثقة عشان يلتقطه المرة الجاية.
        # ده القلب النبضي للـ closed loop: الفرص اللي فاتت بتـ تـ boost التوصيات
        # اللي جاية على نفس السهم. التعديل محصور: +3 لكل missed، سقف +10.
        mb = ticker_summ.get('by_code', {}).get('MISSED_BREAKOUT', {}).get('count', 0)
        if mb >= 2:
            if recommendation == 'proceed':
                recommendation = 'boost'
            _mb_boost = min(10, mb * 3)
            confidence_adjustment = max(0, confidence_adjustment) + _mb_boost
            reason_parts.append(f"السهم {ticker}: فرص ضائعة {mb}× → تعويض +{_mb_boost}")
            if pattern_type in ('none', 'persona_history'):
                pattern_type = 'missed_breakout_compensation'

        # ── D2 (Effective Learning): تأثير مسقوف على وقف الخسارة ──────────
        # مش بس الثقة — كمان نوسّع الوقف بنسبة ATR ضمن سقف، لو السهم/الشخصية
        # عندها STOP_TOO_TIGHT متكرر. ده بـ يغيّر الـ RR فعلياً (مش نفخ ثقة).
        # السقف: 0.5 ATR كحد أقصى للاتساع (ممنوع وقف مفتوح بلا حدود).
        # المثال الموثّق: تكرار وقف سريع للمضارب → توسيع وقف بنسبة ATR.
        stop_widen_atr = 0.0
        applied_lesson = ''
        if stt >= 2:
            stop_widen_atr = round(min(0.5, stt * 0.15), 2)
            applied_lesson = f"widen_stop +{stop_widen_atr:.2f}ATR (STOP_TOO_TIGHT {stt}x on {ticker})"
        else:
            _p_stt = int(persona_summ.get('stop_too_tight_count', 0) or 0)
            if _p_stt >= 3:
                stop_widen_atr = round(min(0.4, _p_stt * 0.08), 2)
                applied_lesson = f"widen_stop +{stop_widen_atr:.2f}ATR (persona {persona_name} STOP_TOO_TIGHT {_p_stt}x)"

        # ── 🔥 VERIFY-RL: Positive reinforcement (win-side adjustments) ──────
        # اقرأ win-lesson counts من persona_summ (اتـ filled في FIX-RL surgical
        # mod لـ lesson_store.get_persona_lesson_summary) + احسب التأثير المسقوف.
        target_raise_r = 0.0
        t1_holdthrough_bias = 0.0
        try:
            _eb_count = int(persona_summ.get('early_breakout_count', 0) or 0)
            _tr_count = int(persona_summ.get('trend_ride_count', 0) or 0)
            if _eb_count >= 2:
                # +0.25R لكل EARLY_BREAKOUT، سقف +1.0R
                target_raise_r = round(min(1.0, 0.25 * _eb_count), 3)
                _win_msg = f"raise_target +{target_raise_r:.2f}R (EARLY_BREAKOUT {_eb_count}x on persona {persona_name})"
                applied_lesson = (applied_lesson + ' · ' if applied_lesson else '') + _win_msg
            if _tr_count >= 3:
                t1_holdthrough_bias = 1.0  # full hold-through
        except Exception as _rl_err:
            import logging as _rl_log
            _rl_log.getLogger(__name__).debug(f"[LEARNING] win-side adjustment failed: {_rl_err}")

        reason = ' · '.join(reason_parts) if reason_parts else f"{total_similar} درس متاح"

        # P3 (Effective Learning): لو فيه دروس بس مفيش adjustment ولا applied_lesson
        # → اطبع no_apply reason صريح. ممنوع conf_adj=+0.0 صامت مع lessons>0.
        # الحالات: win_rate في النطاق المحايد [0.35, 0.65) + مفيش STOP_TOO_TIGHT/
        # LATE_MOMENTUM متكرر → النظام قرّر إنه ميتدخّلش (ده قرار صحيح، بس لازم
        # يتوثّق عشان الـ grep يلاقيه ونعرف إنه مش bug).
        no_apply_reason = ''
        if total_similar > 0 and confidence_adjustment == 0.0 and not applied_lesson:
            if p_total < 3:
                no_apply_reason = f"insufficient_persona_samples (p_total={p_total} < 3)"
            elif 0.35 <= win_rate < 0.65:
                no_apply_reason = f"neutral_zone (win_rate={win_rate:.0%} في [35%, 65%))"
            else:
                no_apply_reason = "no_matching_pattern"

        # ✅ B2 log: سجل قراءة الدروس (مطلوب في الـ spec)
        # نستخدم logger.info (مش print بس) عشان pm2 logs بـ يلتقطها بشكل موثوق.
        _learn_msg = (
            f"[LEARNING] ticker={ticker} persona={persona_name} "
            f"lessons={total_similar} (persona={p_total} ticker={t_total}) "
            f"win_rate={win_rate:.0%} recommendation={recommendation} "
            f"conf_adj={confidence_adjustment:+.1f}"
        )
        if applied_lesson:
            _learn_msg += f" applied={applied_lesson}"
        elif no_apply_reason:
            _learn_msg += f" no_apply={no_apply_reason}"
        logger.info(_learn_msg)
        print(_learn_msg, flush=True)

        return ExpertMemoryResult(
            found_similar=True,
            total_similar=total_similar,
            win_rate=win_rate,
            avg_pnl=avg_pnl,
            confidence_adjustment=round(confidence_adjustment, 1),
            recommendation=recommendation,
            reason=reason,
            pattern_type=pattern_type,
            stop_widen_atr=stop_widen_atr,
            applied_lesson=applied_lesson,
            target_raise_r=target_raise_r,
            t1_holdthrough_bias=t1_holdthrough_bias,
        )
    except Exception as e:
        import logging as _l
        _l.getLogger(__name__).warning(f"[LEARNING] run_expert_memory_phase failed: {e}")
        return ExpertMemoryResult(
            found_similar=False, total_similar=0, win_rate=0.5, avg_pnl=0,
            confidence_adjustment=0, recommendation='proceed',
            reason=f'خطأ في قراءة الدروس: {e}', pattern_type='none',
        )


# ==================== PHASE 7: PERSONA REFINEMENT ====================

def apply_persona_refinement(maestro_score: float, recommendation: str, persona_type: str, entry_price: float, stop_loss: float, target: float) -> PersonaResult:
    config = PERSONA_CONFIGS.get(persona_type.lower(), PERSONA_CONFIGS['balanced'])
    notes = []
    adjusted_score = maestro_score
    position_size_percent = 0
    if maestro_score < config['min_score'] and recommendation in ['buy', 'strong_buy']:
        adjusted_score = maestro_score - 10
        notes.append(f'الدرجة {maestro_score} أقل من الحد الأدنى {config["min_score"]} لهذه الشخصية')
    if recommendation == 'strong_buy':
        position_size_percent = config['max_position_percent']
    elif recommendation == 'buy':
        position_size_percent = config['max_position_percent'] * 0.75
    elif recommendation == 'hold':
        position_size_percent = config['max_position_percent'] * 0.25
    if config['risk_tolerance'] == 'medium':
        notes.append('توقعة متوسطة المخاطرة')
    return PersonaResult(persona_type=persona_type, adjusted_score=adjusted_score, position_size_percent=position_size_percent, notes=notes)


# ==================== CL7-UI-SECTORS — Sector-Aware Refinement ====================
# EGX بيتحرك قطاعات كاملة. بوابة المضارب لازم تأثر بالقطاع: تفضّل قائد قطاع ساخن
# وترفض laggard في قطاع ميت. المستثمر يهتم بالاستقرار القطاعي (يحذر القطاع الميت).
# ده "حقن خفيف" فوق determine_recommendation — مش محرك جديد. الـ caller (background
# analyzer أو أي مسار تحليل) بيمرّر sector_status + sector_role اللي اتحسبوا من
# compute_sector_heat_map / classify_sector_roles في opportunity_quality.

# قاموس التراجع العربي للأوصاف
_SECTOR_REFINE_AR = {
    'laggard_dead': 'مراقبة — laggard في قطاع ميت',
    'leader_hot': 'فرصة قطاعية قوية — قائد قطاع ساخن',
    'investor_dead': 'حذر استثماري — قطاع ميت',
}


def sector_aware_refine_recommendation(
    recommendation: str,
    recommendation_ar: str,
    persona_type: str,
    sector_status: str = 'neutral',
    sector_role: str = 'mid',
) -> tuple:
    """CL7-UI-SECTORS: عدّل التوصية بناءً على حرارة القطاع ودور السهم.

    القواعد (من البروتوكول CL7-UI-SECTORS):
      - Gambler (المضارب):
          * leader في قطاع hot → رقّي buy → strong_buy (فرصة قطاعية قوية)
          * laggard في قطاع dead → خفّض buy/strong_buy → hold (ارفض laggard الميت)
          * غير كده → بدون تغيير
      - Investor (المستثمر):
          * قطاع dead → خفّض strong_buy → buy (حذر استثماري، مش رفض كامل)
          * غير كده → بدون تغيير (المستثمر بيهتم بالأساسيات أكتر من القطاع اللحظي)
      - Balanced: بدون تغيير (القطاع بيتطبّق على الترتيب بس مش على التوصية).

    Args:
        recommendation: التوصية الحالية (buy/strong_buy/hold/sell/...).
        recommendation_ar: التوصية بالعربي.
        persona_type: gambler/conservative/investor/balanced/active_trader.
        sector_status: 'hot' | 'dead' | 'neutral' (من get_sector_heat_status).
        sector_role: 'leader' | 'mid' | 'laggard' (من classify_sector_roles).

    Returns:
        (refined_recommendation, refined_recommendation_ar, note)
        note = وصف التعديل أو '' لو مفيش تغيير.
    """
    rec = (recommendation or 'hold').lower().strip()
    rec_ar = recommendation_ar or ''
    persona = (persona_type or 'balanced').lower().strip()
    status = (sector_status or 'neutral').lower().strip()
    role = (sector_role or 'mid').lower().strip()

    # لو القطاع محايد → مفيش تغيير لأي persona (القطاع المحايد ماليش تأثير)
    if status == 'neutral':
        return rec, rec_ar, ''

    # ── Gambler / active_trader ──
    # القواعد بتاعت المضارب بتحتاج role + status الاتنين (leader/laggard في hot/dead).
    # لو role=mid → مفيش تغيير للمضارب (الـ mid ماليش دور قيادي/متأخر).
    if persona in ('gambler', 'active_trader') and role != 'mid':
        # leader في قطاع ساخن → رقّي buy إلى strong_buy
        if status == 'hot' and role == 'leader' and rec == 'buy':
            note = _SECTOR_REFINE_AR['leader_hot']
            print(f"[SECTOR_REFINE] persona={persona} rec buy→strong_buy "
                  f"status={status} role={role} note={note}")
            return 'strong_buy', 'شراء قوي', note
        # laggard في قطاع ميت → خفّض buy/strong_buy إلى hold
        if status == 'dead' and role == 'laggard' and rec in ('buy', 'strong_buy', 't1_buy', 'swing_buy'):
            note = _SECTOR_REFINE_AR['laggard_dead']
            print(f"[SECTOR_REFINE] persona={persona} rec {rec}→hold "
                  f"status={status} role={role} note={note}")
            return 'hold', 'احتفاظ', note

    # ── Balanced / Investor / conservative ── (P0-v6 FIX #6: sector rotation لكل personas)
    # المالك اشتكى إن المتوازن بيضيع قطاعات كاملة طالعة. قبل كده، Balanced كان
    # NO-OP و Investor بس strong_buy→buy في قطاع ميت. دلوقتي الاتنين ليهم
    # sector-aware refinement:
    if persona in ('balanced', 'conservative', 'investor'):
        # leader في قطاع ساخن → رقّي hold → accumulate (يلحق القطاع الطالع)
        if status == 'hot' and role == 'leader' and rec == 'hold':
            note = f'قائد في قطاع ساخن → ترقية لـ accumulate (يلحق القطاع الطالع)'
            print(f"[SECTOR_REFINE] persona={persona} rec hold→accumulate "
                  f"status={status} role={role} note={note}")
            return 'accumulate', 'تجميع', note
        # laggard في قطاع ميت → خفّض buy إلى hold (ارفض المتأخر في القطاع الميت)
        if status == 'dead' and role == 'laggard' and rec in ('buy', 't1_buy', 'swing_buy'):
            note = f'متأخر في قطاع ميت → تخفيض لـ hold (ارفض المتأخر)'
            print(f"[SECTOR_REFINE] persona={persona} rec {rec}→hold "
                  f"status={status} role={role} note={note}")
            return 'hold', 'احتفاظ', note
        # investor/conservative: قطاع dead → خفّض strong_buy → buy (حذر استثماري)
        if persona in ('conservative', 'investor') and status == 'dead' and rec == 'strong_buy':
            note = _SECTOR_REFINE_AR['investor_dead']
            print(f"[SECTOR_REFINE] persona={persona} rec strong_buy→buy "
                  f"status={status} note={note}")
            return 'buy', 'شراء', note

    # بدون تغيير
    return rec, rec_ar, ''


# ==================== MAIN ORCHESTRATOR ====================

class MaestroOrchestrator:
    def __init__(self, db_path: str, enable_tracking: bool = True):
        self.db_path = db_path
        self.db = DatabaseManager(db_path) if os.path.exists(db_path) else None
        self.master_analyzer = MasterAnalyzer(db_path) if os.path.exists(db_path) else None
        self.prediction_tracker = None
        self.enable_tracking = enable_tracking
        if PREDICTION_TRACKER_AVAILABLE and enable_tracking and os.path.exists(db_path):
            try:
                # PredictionTracker must use predictions.db specifically (where the predictions table lives)
                pred_db_path = os.environ.get('PREDICTIONS_DB', str(_PROJECT_ROOT / 'db' / 'predictions.db'))
                self.prediction_tracker = PredictionTracker(pred_db_path)
                print("[Maestro] Prediction Tracker enabled")
            except Exception as e:
                print(f"[Maestro] Failed to init Prediction Tracker: {e}")

    def analyze(self, ticker: str, stock: Dict, price_history: List[Dict], options: Dict = None) -> MaestroResult:
        options = options or {}
        persona_type = options.get('persona_type', 'balanced')
        force_regime = options.get('force_regime')
        warnings, warnings_ar = [], []

        # =====================================================================
        # EGX-MARKET-ISOLATION (2026-08-30): فلتر صارم لـ EGX canonical فقط.
        # المشكلة: النظام كان بـ يعالج أسهم من 4 أسواق (EGX + TADAWUL + KSE + QSE)
        # + tickers ملوّثة (أسماء شركات + ISIN codes). ده بـ يولّد توقعات لأسهم
        # غير مصرية + tickers غلط مش موجودة في TradingView.
        # الحل: لو الـ ticker مش EGX canonical صحيح → ارجع None (skip).
        # التفاصيل في utils/egx_gate.py.
        # =====================================================================
        try:
            from utils.egx_gate import is_valid_egx_ticker
            if not is_valid_egx_ticker(ticker):
                print(f"[EGX-GATE-REJECT] ticker={ticker} — not EGX canonical → skip analysis", flush=True)
                result = MaestroResult(
                    ticker=ticker,
                    recommendation='hold',
                    recommendation_ar='احتفاظ (غير مصري — تم رفضه)',
                    entry_price=0, target_price=0, stop_loss=0,
                    confidence=0, maestro_score=0,
                )
                result.signal_id = None
                return result
        except Exception as _egx_gate_err:
            # لو الـ gate فشل للسبب ما، سيب النظام يكمّل (safe-by-design)
            logger.debug(f"EGX gate check failed for {ticker}: {_egx_gate_err}")

        closes = [to_num(p.get('close', p.get('close_price', 0))) for p in price_history]
        closes = [c for c in closes if c > 0]
        # ── Closed-Loop A1: استخدم get_live_price() كمصدر أساسي للسعر الحي ──
        # ده بيضمن إن entry_price/target/stop كلها متسقة مع نفس مسار الإغلاق
        # (daily_closer بـ يستخدم نفس get_live_price). لو stocks.db.stocks.current_price
        # ملوّث (زي COMI=18.5 بدل 140)، get_live_price بـ يرجّع السعر الصح من
        # stocks.egksco_stocks.last_price (140.5). ده بـ يمنع إغلاقات بـ 659% خيالية.
        current_price = 0.0
        try:
            from utils.live_price import get_live_price
            _live = get_live_price(ticker)
            if _live and _live > 0:
                current_price = float(_live)
        except Exception:
            pass
        if current_price <= 0:
            current_price = to_num(stock.get('current_price', closes[-1] if closes else 0))

        regime_phase = run_regime_phase(closes, force_regime)
        timeframe_phase = run_timeframe_phase(ticker, price_history)
        volume_phase = run_volume_phase(stock, price_history)
        news_phase = run_news_phase(ticker, self.db_path)

        human_context = gather_context(ticker)
        stock_name_ar = stock.get('name_ar', '') or stock.get('name', '') or ticker
        human_personas = calculate_personas(ticker, human_context, stock)
        human_narrative = generate_narrative(ticker, human_context, human_personas, stock_name_ar)

        # Unified Persona Engine: gambler + investor (جديد — آمن، try/except)
        gambler_dict = None
        investor_dict = None
        persona_narrative = None
        if PERSONA_ENGINE_AVAILABLE:
            try:
                ctx_dict = {
                    'time_context': human_context.time_context if human_context else {},
                    'sector_context': human_context.sector_context if human_context else {},
                    'market_context': human_context.market_context if human_context else {},
                    'historical_context': human_context.historical_context if human_context else {},
                    'behavioral_context': human_context.behavioral_context if human_context else {},
                }
                g_result = analyze_gambler(ticker, stock, ctx_dict)
                gambler_dict = gambler_to_dict(g_result)
            except Exception as e:
                print(f'[Maestro] Persona Gambler error for {ticker}: {e}')
                gambler_dict = None
            try:
                ctx_dict = {
                    'time_context': human_context.time_context if human_context else {},
                    'sector_context': human_context.sector_context if human_context else {},
                    'market_context': human_context.market_context if human_context else {},
                    'historical_context': human_context.historical_context if human_context else {},
                    'behavioral_context': human_context.behavioral_context if human_context else {},
                }
                i_result = analyze_investor(ticker, stock, ctx_dict)
                investor_dict = investor_to_dict(i_result)
            except Exception as e:
                print(f'[Maestro] Persona Investor error for {ticker}: {e}')
                investor_dict = None
            try:
                persona_narrative = generate_persona_narrative(ticker, stock, human_context, gambler_dict, investor_dict)
            except Exception as e:
                print(f'[Maestro] Persona Narrative error for {ticker}: {e}')
                persona_narrative = None

        quality_score = 50.0
        technical_score = 50.0
        if self.master_analyzer:
            try:
                # MAESTRO-UNIFY-015: pass price_history to master_analyzer so it
                # can compute the 8-layer confluence (MACD + Candlestick + Fibonacci)
                # using the SAME history the orchestrator already loaded — no
                # redundant DB hit inside MasterAnalyzer._get_full_price_data.
                analysis = self.master_analyzer.analyze(ticker, history=price_history)
                if analysis:
                    quality_score = getattr(analysis, 'quality_score', 50)
                    technical_score = getattr(analysis, 'technical_score', 50)
            except Exception as e:
                print(f'[Maestro] MasterAnalyzer error: {e}')

        maestro_score = calculate_maestro_score(regime_phase, timeframe_phase, volume_phase, news_phase, quality_score, technical_score, closes)
        price_position = regime_phase.sma_alignment or 'mid_range'
        volume_ratio = volume_phase.volume_ratio
        distance_to_support_pct = 50.0
        if len(closes) >= 20:
            sr = calculate_support_resistance(closes, 20)
            distance_to_support_pct = sr['distance_to_support_pct']

        # === CANDLESTICK PATTERN DETECTION ===
        # This was MISSING - the system had the analyzer but never used it!
        candlestick_bonus = 0
        candlestick_signals = []
        try:
            from analyzers.candlestick import CandlestickAnalyzer, CandleData
            cs_analyzer = CandlestickAnalyzer()
            # Convert price_history to CandleData
            cs_candles = []
            for p in price_history[-30:]:  # last 30 candles
                cs_candles.append(CandleData(
                    open=to_num(p.get('open', p.get('open_price', 0))),
                    high=to_num(p.get('high', p.get('high_price', 0))),
                    low=to_num(p.get('low', p.get('low_price', 0))),
                    close=to_num(p.get('close', p.get('close_price', 0))),
                    volume=to_num(p.get('volume', 0)),
                ))
            if len(cs_candles) >= 3:
                cs_signals = cs_analyzer.analyze_candles_batch(cs_candles)
                if cs_signals:
                    for sig in cs_signals:
                        candlestick_signals.append({
                            'pattern': sig.pattern_name,
                            'pattern_ar': sig.pattern_name_ar,
                            'direction': sig.signal_direction,
                            'confidence': sig.confidence,
                            'strength': sig.strength,
                        })
                        # BULLISH patterns boost score
                        if sig.signal_direction == 'BULLISH':
                            if sig.strength == 'STRONG':
                                candlestick_bonus += 15
                            elif sig.strength == 'MODERATE':
                                candlestick_bonus += 8
                            else:
                                candlestick_bonus += 3
                            warnings.append(f'نمط شموع: {sig.pattern_name_ar} ({sig.pattern_name}) +{sig.strength}')
                            warnings_ar.append(f'نمط شموع يابانية: {sig.pattern_name_ar} ({sig.pattern_name}) - إشارة صعودية {sig.strength}')
                        # BEARISH patterns reduce score
                        elif sig.signal_direction == 'BEARISH':
                            if sig.strength == 'STRONG':
                                candlestick_bonus -= 15
                            elif sig.strength == 'MODERATE':
                                candlestick_bonus -= 8
                            else:
                                candlestick_bonus -= 3
                            warnings.append(f'نمط شموع: {sig.pattern_name_ar} ({sig.pattern_name}) -{sig.strength}')
                            warnings_ar.append(f'نمط شموع يابانية: {sig.pattern_name_ar} ({sig.pattern_name}) - إشارة هبوطية {sig.strength}')
        except Exception as _cs_err:
            pass

        # === CHART PATTERN DETECTION (head&shoulders, double top/bottom) ===
        chart_pattern_bonus = 0
        try:
            from analyzers.patterns import PatternRecognitionEngine
            pe = PatternRecognitionEngine()
            if len(closes) >= 20:
                highs = [to_num(p.get('high', p.get('high_price', 0))) for p in price_history[-50:]]
                lows = [to_num(p.get('low', p.get('low_price', 0))) for p in price_history[-50:]]
                pattern = pe.analyze(highs, lows, closes[-50:] if len(closes) >= 50 else closes)
                if pattern:
                    if pattern.signal == 'BULLISH':
                        chart_pattern_bonus += 10
                        warnings.append(f'نمط رسم بياني: {pattern.pattern_type.value} - صعودي')
                        warnings_ar.append(f'نمط رسم بياني: {pattern.pattern_type.value} - إشارة صعودية')
                    elif pattern.signal == 'BEARISH':
                        chart_pattern_bonus -= 10
                        warnings.append(f'نمط رسم بياني: {pattern.pattern_type.value} - هبوطي')
                        warnings_ar.append(f'نمط رسم بياني: {pattern.pattern_type.value} - إشارة هبوطية')
        except Exception as _pe_err:
            pass

        # Apply candlestick + chart pattern bonus
        total_pattern_bonus = max(-20, min(25, candlestick_bonus + chart_pattern_bonus))
        if total_pattern_bonus != 0:
            maestro_score = max(0, min(100, maestro_score + total_pattern_bonus))

        # ========================================
        # DNA-WIRING (Axis A): تطبيق ملف السهم التكيفي (Stock DNA)
        # ========================================
        # الـ DNA بيقول للمايسترو: هل السهم ده "حيّ" (alive) ولا "نائم"؟
        # السهم الحيّ (amplifier عالي / volume_spike متكرر / momentum قوي)
        # يستاهل threshold_boost (سالب) يخفض عتبات التوصية + confidence_boost.
        # الكود ده بيكمّل اللي في master_analyzer.py — الاتنين بقرّوا نفس
        # الـ stock_adaptive_profiles table عشان القرار يتوحد.
        # ========================================
        dna_threshold_boost = 0.0
        dna_confidence_boost = 0.0
        try:
            if self.master_analyzer and hasattr(self.master_analyzer, '_load_stock_dna'):
                _dna = self.master_analyzer._load_stock_dna(ticker)
                if _dna and _dna.get('is_alive'):
                    dna_threshold_boost = float(_dna.get('threshold_boost') or 0)
                    dna_confidence_boost = float(_dna.get('confidence_boost') or 0)
                    _amp = float(_dna.get('amplifier_score') or 0)
                    _spike = float(_dna.get('volume_spike_freq') or 0)
                    _mom = float(_dna.get('momentum_score') or 0)
                    _pers = _dna.get('personality_type_ar') or ''
                    if _dna.get('constraints_loosened'):
                        print(
                            f"[Maestro] {ticker}: DNA ALIVE amp={_amp:.2f} "
                            f"spike={_spike:.2f} mom={_mom:.2f} "
                            f"→ thr{dna_threshold_boost:+.0f} "
                            f"conf{dna_confidence_boost:+.0f} ({_pers})"
                        )
        except Exception as _dna_err:
            print(f"[Maestro] DNA load error for {ticker}: {_dna_err}")

        # P40-DNA-WIRING: اقرأ الـ Stock DNA قبل الـ verdict عشان تخفّف القيود
        # للأسهم اللي بيتحرك بقوة (amplifier / متقلب / مضاربي). get_stock_profile
        # عنده cache (512 سهم) فالقراءة سريعة ومش بتكلّف query.
        _verdict_profile = None
        try:
            from analyzers.stock_dna_analyzer import get_stock_profile
            _verdict_profile = get_stock_profile(ticker)
        except Exception:
            _verdict_profile = None

        # 🔥 P0-v6 FIX #2 (VCP-WIRING): كشف VCP (Volatility Contraction Pattern)
        #    مباشرةً في maestro قبل determine_recommendation. الـ detector كامل في
        #    glminvestment_engines/engines/vcp_detector.py بس كان bypassed في
        #    background_analyzer لو warnings فيها 'شراء'. دلوقتي بنستدعيه مباشرة.
        #    لو VCP found AND score ≥ 85 → force strong_buy + confidence boost.
        #    ده بـ يـ catches الأسهم اللي بتعمل +30-100% بعد انكماش + انفجار حجم.
        _vcp_breakout = False
        _vcp_score = 0
        try:
            from glminvestment_engines.engines.vcp_detector import detect_vcp as _detect_vcp_fn
            import pandas as _vcp_pd
            if price_history and len(price_history) >= 60:
                _vcp_rows = []
                for p in price_history:
                    _vcp_rows.append({
                        'close': float(p.get('close', p.get('close_price', 0)) or 0),
                        'high': float(p.get('high', p.get('high_price', 0)) or 0),
                        'low': float(p.get('low', p.get('low_price', 0)) or 0),
                        'volume': float(p.get('volume', p.get('volume_traded', 0)) or 0),
                    })
                _vcp_df = _vcp_pd.DataFrame(_vcp_rows)
                _vcp_df = _vcp_df[(_vcp_df['close'] > 0) & (_vcp_df['high'] > 0) & (_vcp_df['low'] > 0)]
                if len(_vcp_df) >= 60:
                    _vcp_res = _detect_vcp_fn(_vcp_df)
                    if _vcp_res.get('found') and float(_vcp_res.get('score', 0)) >= 85:
                        _vcp_breakout = True
                        _vcp_score = int(_vcp_res.get('score', 0))
                        print(f"[VCP-BREAKOUT] ticker={ticker} score={_vcp_score} contractions={_vcp_res.get('contractions')} near_high={_vcp_res.get('near_high')}", flush=True)
        except Exception as _vcp_err:
            logger.debug(f"VCP detection failed for {ticker}: {_vcp_err}")

        # =====================================================================
        # FIX-4B (C-PERSONA-WIRING): Seasonality Engine V2 wiring
        # الـ seasonality_engine_v2 موجود بس كان orphan — مش متوصّل بـ maestro_score.
        # دلوقتي بنستدعيه قبل determine_recommendation عشان الـ total_score
        # (additive في [-20, +20]) يـ boost/penalize الـ maestro_score قبل الـ verdict.
        # القاعدة الذهبية للخبير "زد": "الموسمية مساعدة مش كفّارة" — لذلك الـ boost
        # بـ يـ cap عند +5 (مش الـ +20 الكامل) والـ penalty بـ يـ cap عند -5.
        # الـ API الفعلي: SeasonalityEngineV2(db_path).analyze(ticker, sector, date)
        # بـ يرجّع dict فيه 'total_score' (additive in [-20, +20]).
        # =====================================================================
        try:
            from analyzers.seasonality_engine_v2 import SeasonalityEngineV2
            _seas_engine = SeasonalityEngineV2(self.db_path)
            _seas_result = _seas_engine.analyze(
                ticker, sector=(stock.get('sector') if isinstance(stock, dict) else None)
            )
            if isinstance(_seas_result, dict):
                _seas_total = float(_seas_result.get('total_score', 0.0) or 0.0)
                # Boost: لو seasonality قوي موجب (>= +5) → +5 points (capped)
                if _seas_total >= 5.0:
                    _seas_boost = min(5.0, _seas_total)
                    maestro_score = min(100.0, float(maestro_score) + _seas_boost)
                    print(f"[SEASONALITY_V2] ticker={ticker} boost=+{_seas_boost:.1f} "
                          f"(total_score={_seas_total:+.2f}) → maestro_score={maestro_score:.1f}",
                          flush=True)
                    warnings.append(f'Seasonality boost: +{_seas_boost:.1f} (monthly+weekday+sector)')
                    warnings_ar.append(f'تعزيز الموسمية: +{_seas_boost:.1f} (نمط شهري/يومي/قطاعي إيجابي)')
                # Penalty: لو seasonality سلبي قوي (<= -5) → -5 points (capped)
                elif _seas_total <= -5.0:
                    _seas_pen = max(-5.0, _seas_total)
                    maestro_score = max(0.0, float(maestro_score) + _seas_pen)
                    print(f"[SEASONALITY_V2] ticker={ticker} penalty={_seas_pen:.1f} "
                          f"(total_score={_seas_total:+.2f}) → maestro_score={maestro_score:.1f}",
                          flush=True)
                    warnings.append(f'Seasonality penalty: {_seas_pen:.1f} (recurring drop / weak month)')
                    warnings_ar.append(f'عقوبة الموسمية: {_seas_pen:.1f} (انخفاض متكرر / شهر ضعيف)')
        except Exception as _seas_err:
            logger.debug(f"Seasonality V2 wiring failed for {ticker}: {_seas_err}")

        # =====================================================================
        # FIX-4C (C-PERSONA-WIRING): LiquidityFilter wiring
        # الـ LiquidityFilter class موجود في analyzers/liquidity_filter.py بس كان
        # orphan — ما بيستخدموش الـ maestro. دلوقتي بنستدعيه قبل الـ verdict:
        # لو السهم NOT tradeable (مرفوض من فلتر السيولة) → خفض maestro_score -10.
        # الـ API الفعلي: LiquidityFilter(db_path).analyze(ticker) → LiquidityProfile
        # بـ يحتوي على .is_tradeable (bool) + .level (Enum) + .warning (str).
        # =====================================================================
        try:
            from analyzers.liquidity_filter import LiquidityFilter
            _lf = LiquidityFilter(self.db_path)
            _liq_profile = _lf.analyze(ticker)
            if _liq_profile and not _liq_profile.is_tradeable:
                # سهم مرفوض من فلتر السيولة → خفض score -10
                maestro_score = max(0.0, float(maestro_score) - 10.0)
                _liq_level = getattr(_liq_profile.level, 'value', str(_liq_profile.level))
                _liq_warn = _liq_profile.warning or 'low liquidity'
                print(f"[LIQUIDITY_FILTER] ticker={ticker} NOT tradeable → score -10 "
                      f"(level={_liq_level}, warning={_liq_warn}) → maestro_score={maestro_score:.1f}",
                      flush=True)
                warnings.append(f'Liquidity veto: {_liq_warn}')
                warnings_ar.append(f'فلتر السيولة: {_liq_warn}')
        except Exception as _lf_err:
            logger.debug(f"LiquidityFilter wiring failed for {ticker}: {_lf_err}")

        # =====================================================================
        # UNIFIED-LOGIC (2026-08-30): Correction Stage Classifier + Entry Gate
        # المنطق الموحد المطلوب من المالك: تصنيف حالة السهم قبل أي قرار دخول.
        # 4 حالات: DEEP_CORRECTION / LATE_CORRECTION_BASE / RECOVERY_STARTING / EXTENDED_CHASE
        # + entry gate يرفض BUY لو السهم في تصحيح نشط أو مطاردة.
        # التفاصيل في utils/stock_state.py:classify_correction_stage.
        # =====================================================================
        _correction_stage = None
        _recovery_confirmed = False
        _entry_vetoed = False
        _entry_veto_reason = ''
        try:
            from utils.stock_state import (
                classify_correction_stage as _classify_stage,
                is_in_active_correction as _is_in_active_corr,
                is_extended_chase as _is_extended_chase,
                confirm_recovery_starting as _confirm_recovery,
            )
            # بناء stock dict للـ classifier
            _cls_stock = dict(stock) if isinstance(stock, dict) else {}
            _cls_stock['current_price'] = current_price
            _cls_stock['change_percent'] = (float(stock.get('change_percent') or 0) if isinstance(stock, dict) and stock.get('change_percent') is not None else 0)
            if not _cls_stock.get('ma_50') and len(closes) >= 50:
                _cls_stock['ma_50'] = sum(closes[-50:]) / 50.0
            if not _cls_stock.get('avg_volume') and price_history:
                _vols = [to_num(p.get('volume', p.get('volume_traded', 0))) for p in price_history[-20:]]
                _vols = [v for v in _vols if v > 0]
                if _vols:
                    _cls_stock['avg_volume'] = sum(_vols) / len(_vols)
            if not _cls_stock.get('volume') and price_history:
                _cls_stock['volume'] = to_num(price_history[-1].get('volume', price_history[-1].get('volume_traded', 0)))

            _correction_stage = _classify_stage(_cls_stock, price_history)

            # Entry gate: رفض BUY لو السهم في DEEP_CORRECTION أو EXTENDED_CHASE
            if _correction_stage and _correction_stage.get('stage') in ('DEEP_CORRECTION', 'EXTENDED_CHASE'):
                _entry_vetoed = True
                _entry_veto_reason = _correction_stage.get('reason', 'السهم في مرحلة غير مناسبة للدخول')
                print(f"[ENTRY-GATE] ticker={ticker} stage={_correction_stage.get('stage')} "
                      f"→ BUY vetoed ({_entry_veto_reason})", flush=True)

            # Entry gate إضافي: رفض BUY لو في تصحيح نشط (is_in_active_correction)
            if not _entry_vetoed and _is_in_active_corr(_cls_stock):
                _entry_vetoed = True
                _entry_veto_reason = 'السهم في تصحيح نشط (تحت MA50 + change<0 + RSI<45)'
                print(f"[ENTRY-GATE] ticker={ticker} active_correction → BUY vetoed", flush=True)

            # Don't Chase: فلتر إضافي مستقل (حتى لو stage مش EXTENDED_CHASE)
            if not _entry_vetoed and _is_extended_chase(_cls_stock, price_history):
                _entry_vetoed = True
                _entry_veto_reason = "Don't Chase: طلع كتير بدري (≥12% في 3 أيام أو ≥15% في 5 أيام)"
                print(f"[ENTRY-GATE] ticker={ticker} extended_chase → BUY vetoed", flush=True)

            # Recovery confirmation: تأكيد بدء التعافي (لو stage=RECOVERY_STARTING)
            if _correction_stage and _correction_stage.get('stage') == 'RECOVERY_STARTING':
                _sector_chng = options.get('sector_change')
                _rec_result = _confirm_recovery(_cls_stock, price_history, sector_change=_sector_chng)
                _recovery_confirmed = bool(_rec_result.get('confirmed'))
                if not _recovery_confirmed:
                    # لو stage قال RECOVERY_STARTING بس confirmation فشل → نشيل الـ allow_entry
                    _correction_stage['allow_entry'] = False
                    _correction_stage['reason'] = _rec_result.get('failed', ['تأكيد التعافي غير مكتمل'])
                    if isinstance(_correction_stage['reason'], list):
                        _correction_stage['reason'] = '؛ '.join(_correction_stage['reason'])
                    print(f"[RECOVERY-CONFIRM] ticker={ticker} recovery NOT confirmed: "
                          f"score={_rec_result.get('score')}/5 failed={_rec_result.get('failed')}", flush=True)
                else:
                    print(f"[RECOVERY-CONFIRM] ticker={ticker} recovery CONFIRMED "
                          f"score={_rec_result.get('score')}/5", flush=True)
        except Exception as _cs_err:
            logger.debug(f"Correction stage classifier failed for {ticker}: {_cs_err}")

        recommendation, recommendation_ar = determine_recommendation(
            maestro_score, regime_phase.phase, volume_ratio, price_position,
            distance_to_support_pct, persona_type=persona_type,
            stock_profile=_verdict_profile,
            threshold_boost=dna_threshold_boost,
        )

        # =====================================================================
        # UNIFIED-LOGIC (2026-08-30): Entry Gate Hard Veto
        # لو الـ entry gate رفض BUY → حول أي إشارة شراء لـ HOLD.
        # السبب: المنطق الموحد بيقول "ممنوع دخول" لو السهم في DEEP_CORRECTION أو
        # EXTENDED_CHASE أو تصحيح نشط. أي BUY/STRONG_BUY → HOLD.
        # =====================================================================
        if _entry_vetoed and recommendation in ('buy', 'strong_buy', 't1_buy', 'swing_buy'):
            recommendation = 'hold'
            recommendation_ar = f'احتفاظ ({_entry_veto_reason})'
            warnings.append(f'Entry gate veto: {_entry_veto_reason}')
            warnings_ar.append(f'بوابة الدخول: {_entry_veto_reason}')

        # =====================================================================
        # PRODUCTION-WIRING (2026-08-30): ربط sector filter + BOS/ChoCH + liquidity
        # في MaestroOrchestrator (الإنتاج الحقيقي) — مش بس v40_2_daily_generator.
        # =====================================================================
        # 1) Sector Liquidity Filter
        try:
            import sqlite3 as _prod_sec_sql
            _prod_sec_db = str(Path(__file__).resolve().parents[2] / 'db' / 'stocks.db')
            _prod_conn = _prod_sec_sql.connect(_prod_sec_db, timeout=5.0)
            _prod_conn.row_factory = _prod_sec_sql.Row
            _prod_sec_row = _prod_conn.execute(
                "SELECT sector FROM stocks WHERE ticker = ? AND market = 'EGX' LIMIT 1", (ticker,)
            ).fetchone()
            _prod_sector = _prod_sec_row['sector'] if _prod_sec_row and _prod_sec_row['sector'] else None
            if _prod_sector and _prod_sector not in ('', '—', None, 'Diversified', 'diversified', 'غير مصنف'):
                _prod_stats = _prod_conn.execute(
                    "SELECT COUNT(*) as n, AVG(change_percent) as avg_chg, SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as rising FROM stocks WHERE market = 'EGX' AND sector = ? AND change_percent IS NOT NULL",
                    (_prod_sector,)
                ).fetchone()
                if _prod_stats and _prod_stats['n'] >= 3:
                    _prod_avg = float(_prod_stats['avg_chg'] or 0)
                    _prod_rising_pct = int(_prod_stats['rising'] or 0) / _prod_stats['n']
                    if _prod_avg <= -1.0 and _prod_rising_pct <= 0.25:
                        if recommendation in ('buy', 'strong_buy', 't1_buy', 'swing_buy'):
                            recommendation = 'hold'
                            recommendation_ar = f'احتفاظ (قطاع ميت: {_prod_sector[:20]})'
                            warnings.append(f'Sector dead: {_prod_sector} avg={_prod_avg:+.2f}%')
                            warnings_ar.append(f'القطاع ميت: {_prod_sector} (متوسط {_prod_avg:+.2f}%)')
                            print(f"[PROD-SECTOR-DEAD] {ticker}: sector={_prod_sector[:20]} → HOLD", flush=True)
            _prod_conn.close()
        except Exception:
            pass

        # 2) BOS/ChoCH
        try:
            from engines.v38_backtest_engine import detect_order_blocks_and_sweeps
            _prod_ob = detect_order_blocks_and_sweeps(
                [to_num(p.get('high', p.get('high_price', 0))) for p in price_history[-50:]],
                [to_num(p.get('low', p.get('low_price', 0))) for p in price_history[-50:]],
                [to_num(p.get('close', p.get('close_price', 0))) for p in price_history[-50:]],
                lookback=5
            )
            if _prod_ob.broke_support and not _prod_ob.sweep_low:
                if recommendation in ('buy', 'strong_buy', 't1_buy', 'swing_buy'):
                    recommendation = 'hold'
                    recommendation_ar = 'احتفاظ (كسر دعم — ChoCH bear)'
                    warnings.append(f'ChoCH bear: broke support {_prod_ob.last_support:.2f}')
                    warnings_ar.append(f'كسر دعم: {_prod_ob.last_support:.2f} — ترند هابط')
                    print(f"[PROD-CHOCH-BEAR] {ticker}: broke support={_prod_ob.last_support:.2f} → HOLD", flush=True)
        except Exception:
            pass

        # 3) Liquidity Classification
        try:
            from core.opportunity_quality import classify_liquidity
            _prod_liq = classify_liquidity(
                [to_num(p.get('close', p.get('close_price', 0))) for p in price_history[-30:]],
                [to_num(p.get('volume', p.get('volume_traded', 0))) for p in price_history[-30:]],
                [to_num(p.get('open', p.get('open_price', 0))) for p in price_history[-30:]],
                [to_num(p.get('high', p.get('high_price', 0))) for p in price_history[-30:]],
                [to_num(p.get('low', p.get('low_price', 0))) for p in price_history[-30:]],
            )
            if _prod_liq['type'] == 'weak' and recommendation in ('buy', 'strong_buy'):
                maestro_score = max(0, maestro_score - 5)
                warnings.append(f'Weak liquidity: vol_ratio={_prod_liq["vol_ratio"]:.2f}')
                warnings_ar.append(f'سيولة ضعيفة: حجم منخفض')
        except Exception:
            pass

        # 🔥 P0-v6 FIX #2 (VCP force-strong-buy):
        #    VCP score ≥ 85 = إشارة اختراق عالية الثقة → force strong_buy مهما
        #    كانت التوصية الأصلية (حتى لو hold/reduce). + confidence boost.
        if _vcp_breakout and recommendation not in ('sell', 'strong_sell', 'reduce'):
            if recommendation != 'strong_buy':
                recommendation = 'strong_buy'
                recommendation_ar = 'شراء قوي (VCP breakout — انكماش ثم انفجار)'
                warnings.append(f'VCP breakout detected (score={_vcp_score}) → forced strong_buy')
                warnings_ar.append(f'نموذج VCP قوي (درجة {_vcp_score}) — شراء قوي إجباري')
            confidence = max(confidence, 80.0) if 'confidence' in dir() else 80.0

        # P21-PERSONA-CONSTRAINTS (Aug 2026): Conservative Veto
        # المحافظ بيرفض BUY لو السوق هابط (bear regime) — يحوّلها HOLD.
        # المضارب والمتوازن ما عليهومش القيد ده (يلحقوا السوق).
        if persona_type in ('conservative', 'investor') and regime_phase.phase == 'bear' and recommendation in ('buy', 'strong_buy', 't1_buy', 'swing_buy'):
            recommendation = 'hold'
            recommendation_ar = 'احتفاظ (سوق هابط — حماية رأس المال)'
            warnings.append('Conservative veto: bear regime → HOLD')
            warnings_ar.append('السوق هابط — تم تحويل التوصية لاحتفاظ لحماية رأس المال')

        # If candlestick patterns are strongly bullish, upgrade recommendation
        if candlestick_bonus >= 15 and maestro_score >= 55 and recommendation in ['hold', 'reduce', 'sell']:
            recommendation = 'buy'
            recommendation_ar = 'شراء (نمط شموع صعودي قوي)'
        elif candlestick_bonus >= 20 and maestro_score >= 65:
            recommendation = 'strong_buy'
            recommendation_ar = 'شراء قوي (نمط شموع صعودي قوي)'

        if news_phase.should_hold and recommendation in ['buy', 'strong_buy', 't1_buy', 'swing_buy']:
            recommendation = 'hold'
            recommendation_ar = 'احتفاظ (أخبار)'
            warnings.append('Recommendation changed to HOLD due to recent news')
            warnings_ar.append('التوقعة تغيرت لاحتفاظ بسبب الأخبار الحديثة')

        # CL7-UI-SECTORS: حقن القطاع في القرار (sector-aware refine).
        # الـ caller (background_analyzer) بيمرّر sector_status + sector_role في
        # options بعد ما يحسبهم من compute_sector_heat_map / classify_sector_roles.
        # القواعد: المضارب بيرفض laggard في قطاع ميت (buy→hold)، ويرقّي leader في
        # قطاع ساخن (buy→strong_buy). المستثمر بيحذر القطاع الميت (strong_buy→buy).
        _cl7_status = (options.get('sector_status') or 'neutral').lower()
        _cl7_role = (options.get('sector_role') or 'mid').lower()
        if _cl7_status != 'neutral' and _cl7_role != 'mid':
            recommendation, recommendation_ar, _cl7_note = sector_aware_refine_recommendation(
                recommendation, recommendation_ar, persona_type, _cl7_status, _cl7_role,
            )
            if _cl7_note:
                warnings.append(f'Sector refine: {_cl7_note}')
                warnings_ar.append(_cl7_note)

        # =====================================================================
        # 🔥 P0-v7 TASK #3 (SECTOR HEAT GATE — HARD VETO):
        # المالك طلب: "تفعيل حظر كامل لأي إشارة شراء (BUY / STRONG_BUY) للأسهم
        # اللي تقع في قطاعات ميتة (Dead Sectors)". الـ CL7 soft refine فوقه
        # بيعمل downgrade بس في حالات معينة (laggard في dead). هنا بنعمل HARD
        # veto: أي BUY/STRONG_BUY في قطاع ميت → HOLD (لكل personas، مش بس gambler).
        # الاستثناء: leader في قطاع ميت (sector rotating — السهم بيقود والقطاع
        # لسه ميت) → نسمح بـ buy بس مش strong_buy (حذر).
        # =====================================================================
        if _cl7_status == 'dead' and recommendation in ('buy', 'strong_buy', 't1_buy', 'swing_buy'):
            if _cl7_role == 'leader':
                # leader في قطاع ميت → downgrade لـ buy (مش strong_buy) — حذر
                if recommendation == 'strong_buy':
                    recommendation = 'buy'
                    recommendation_ar = 'شراء (قائد في قطاع ميت — حذر)'
                    warnings.append('Sector Heat Gate: strong_buy→buy (leader في قطاع ميت)')
                    warnings_ar.append('بوابة القطاع: تخفيض لشراء (قائد في قطاع ميت)')
                    print(f"[SECTOR_VETO_HARD] ticker={ticker} strong_buy→buy "
                          f"(leader in dead sector)", flush=True)
            else:
                # mid/laggard في قطاع ميت → HOLD (HARD veto)
                _vetoed_rec = recommendation
                recommendation = 'hold'
                recommendation_ar = 'احتفاظ (قطاع ميت — حظر الشراء)'
                warnings.append(f'Sector Heat Gate HARD VETO: {_vetoed_rec}→hold (قطاع ميت)')
                warnings_ar.append(f'بوابة القطاع: حظر الشراء ({_vetoed_rec}→احتفاظ) — القطاع ميت')
                print(f"[SECTOR_VETO_HARD] ticker={ticker} {_vetoed_rec}→hold "
                      f"(dead sector, role={_cl7_role})", flush=True)

        # =====================================================================
        # UNIFIED-LOGIC (2026-08-30): Market Breadth Hard Veto
        # المنطق الموحد: "ممنوع دخول ضد الاتجاه (تحت SMA50 أو السوق هابط بقوة)".
        # Sector Confirmation + Market regime veto — لو السوق هابط بقوة → HOLD.
        # التفاصيل في analyzers/institutional_decision_engine.py:_check_market_breadth_veto.
        # =====================================================================
        try:
            from analyzers.institutional_decision_engine import _check_market_breadth_veto
            # بناء market_regime dict من regime_phase
            _market_regime = {
                'trend': regime_phase.phase,
                'confidence': regime_phase.confidence,
            }
            _breadth_pct = options.get('breadth_pct')
            _benchmark_change = float(options.get('benchmark_change') or 0.0)
            _vetoed, _veto_reason = _check_market_breadth_veto(
                _market_regime, _benchmark_change, _breadth_pct
            )
            if _vetoed and recommendation in ('buy', 'strong_buy', 't1_buy', 'swing_buy'):
                _vetoed_rec = recommendation
                recommendation = 'hold'
                recommendation_ar = f'احتفاظ (سوق هابط — {_veto_reason})'
                warnings.append(f'Market breadth veto: {_vetoed_rec}→hold ({_veto_reason})')
                warnings_ar.append(f'حظر السوق الهابط: {_veto_reason}')
                print(f"[MARKET-VETO] ticker={ticker} {_vetoed_rec}→hold "
                      f"({_veto_reason})", flush=True)
        except Exception as _mb_err:
            logger.debug(f"Market breadth veto wiring failed for {ticker}: {_mb_err}")

        # P1 fix (يوليو 2026): round(..., 0) بيرجّع 1.0 → 1.0*100=100 (غلط)
        # الصح: round(..., 2) * 100 عشان يبقى 94% مش 100%
        confidence = round((regime_phase.confidence * 0.2 + (0.8 if timeframe_phase.aligned else 0.5) * 0.3 + (0.9 if volume_phase.liquidity_rating == 'high' else 0.7 if volume_phase.liquidity_rating == 'medium' else 0.5) * 0.25 + 0.7 * 0.25), 2) * 100
        # DNA-WIRING (Axis A): السهم "الحيّ" ياخد confidence boost
        confidence = max(0, min(100, confidence + dna_confidence_boost))

        # === BONUS: EGXPilot + data-engine.db ratings boost ===
        # The system was blind to external ratings. Now we boost score based on:
        # 1. EGXPilot recommendation (Strong Buy = +15, Buy = +10)
        # 2. data-engine.db technical_rating (شراء قوي = +10, شراء = +5)
        # 3. data-engine.db performance (1W > 5% = +5, 1M > 10% = +5)
        #
        # 🔥 FRESHNESS GUARD (2026-08-17): Only apply bonus if data_engine.db
        # was updated within the last 3 days. If the TradingView scraper hasn't
        # run recently, the external ratings are STALE and should NOT boost
        # the score. This prevents the "مدعوم بالتقييمات الخارجية" label from
        # appearing on old data.
        try:
            bonus = 0
            bonus_reasons = []
            _data_is_fresh = False  # Default: assume stale

            # Check data-engine.db for technical rating
            import sqlite3 as _de_sql
            import os as _de_os
            from datetime import datetime as _dt, timedelta as _td
            _de_path = _de_os.path.join(_de_os.path.dirname(_de_os.path.dirname(_de_os.path.dirname(_de_os.path.abspath(__file__)))), 'db', 'data_engine.db')
            if _de_os.path.exists(_de_path):
                _de_conn = _de_sql.connect(_de_path)
                _de_conn.row_factory = _de_sql.Row
                _de_cur = _de_conn.cursor()

                # ── FRESHNESS CHECK ──
                # Try to find the most recent last_updated / updated_at across
                # the tab_* tables. If none found, fall back to checking the
                # stocks table's updated_at column.
                _freshness_cutoff = (_dt.utcnow() - _td(days=3)).isoformat()
                try:
                    # Try last_updated on tab_technical_analysis first
                    _fresh_row = _de_cur.execute(
                        "SELECT MAX(last_updated) as max_upd FROM tab_technical_analysis"
                    ).fetchone()
                    if _fresh_row and _fresh_row['max_upd']:
                        _max_upd = str(_fresh_row['max_upd'])
                        # Parse and compare (handles both ISO and 'YYYY-MM-DD HH:MM:SS' formats)
                        try:
                            _upd_dt = _dt.fromisoformat(_max_upd.replace(' ', 'T').split('.')[0])
                            _data_is_fresh = _upd_dt > (_dt.utcnow() - _td(days=3))
                        except (ValueError, TypeError):
                            _data_is_fresh = False
                except (_de_sql.OperationalError, _de_sql.DatabaseError):
                    # last_updated column doesn't exist → check stocks table
                    try:
                        _stk_fresh = _de_cur.execute(
                            "SELECT MAX(updated_at) as max_upd FROM stocks"
                        ).fetchone()
                        if _stk_fresh and _stk_fresh['max_upd']:
                            _max_upd = str(_stk_fresh['max_upd'])
                            try:
                                _upd_dt = _dt.fromisoformat(_max_upd.replace(' ', 'T').split('.')[0])
                                _data_is_fresh = _upd_dt > (_dt.utcnow() - _td(days=3))
                            except (ValueError, TypeError):
                                _data_is_fresh = False
                    except (_de_sql.OperationalError, _de_sql.DatabaseError):
                        _data_is_fresh = False

                if not _data_is_fresh:
                    # Data is stale (>3 days old) — skip external bonus entirely
                    warnings.append('⚠️ بيانات التقييمات الخارجية قديمة (>3 أيام) — تم تجاهلها')
                    warnings_ar.append('⚠️ بيانات التقييمات الخارجية قديمة (>3 أيام) — تم تجاهلها')
                else:
                    # Data is fresh — apply the bonus
                    # Technical rating
                    _de_row = _de_cur.execute("SELECT technical_rating, ma_rating FROM tab_technical_analysis WHERE ticker = ? LIMIT 1", (ticker,)).fetchone()  # PILLAR-2.5: tab_* uses ticker PK
                    if _de_row:
                        _rating = str(_de_row['technical_rating'] or '').lower()
                        _ma_rating = str(_de_row['ma_rating'] or '').lower()
                        if 'strong buy' in _rating or 'شراء قوي' in _rating:
                            bonus += 10
                            bonus_reasons.append('تقييم فني: شراء قوي (+10)')
                        elif 'buy' in _rating or 'شراء' in _rating:
                            bonus += 5
                            bonus_reasons.append('تقييم فني: شراء (+5)')
                        elif 'sell' in _rating or 'بيع' in _rating:
                            bonus -= 10
                            bonus_reasons.append('تقييم فني: بيع (-10)')

                        if 'strong buy' in _ma_rating or 'شراء قوي' in _ma_rating:
                            bonus += 5
                            bonus_reasons.append('المتوسطات: شراء قوي (+5)')

                    # Performance
                    _perf_row = _de_cur.execute("SELECT perf_1w, perf_1m, perf_3m FROM tab_performance WHERE ticker = ? LIMIT 1", (ticker,)).fetchone()  # PILLAR-2.5: tab_* uses ticker PK
                    if _perf_row:
                        import re as _re
                        def _extract_num(val):
                            if val is None: return 0
                            m = _re.search(r'([+-]?\d+\.?\d*)', str(val).replace('−','-'))
                            return float(m.group(1)) if m else 0

                        _1w = _extract_num(_perf_row['perf_1w'])
                        _1m = _extract_num(_perf_row['perf_1m'])
                        _3m = _extract_num(_perf_row['perf_3m'])

                        if _1w > 5: bonus += 5; bonus_reasons.append(f'أداء أسبوعي +{_1w:.1f}% (+5)')
                        if _1m > 10: bonus += 5; bonus_reasons.append(f'أداء شهري +{_1m:.1f}% (+5)')
                        if _3m > 20: bonus += 5; bonus_reasons.append(f'أداء 3 شهور +{_3m:.1f}% (+5)')

                _de_conn.close()

            # Apply bonus (max +25, min -15) — ONLY if data is fresh
            if _data_is_fresh:
                bonus = max(-15, min(25, bonus))
                if bonus != 0:
                    maestro_score = max(0, min(100, maestro_score + bonus))
                    if bonus_reasons:
                        warnings.extend(bonus_reasons)
                        warnings_ar.extend(bonus_reasons)

                    # Re-evaluate recommendation based on new score
                    # Use bull market thresholds since external ratings confirm strength
                    if maestro_score >= 75:
                        recommendation = 'strong_buy'
                        recommendation_ar = 'شراء قوي (مدعوم بالتقييمات الخارجية)'
                    elif maestro_score >= 60:
                        recommendation = 'buy'
                        recommendation_ar = 'شراء (مدعوم بالتقييمات الخارجية)'
                    elif maestro_score >= 45:
                        recommendation = 'hold'
                        recommendation_ar = 'احتفاظ'
                    elif maestro_score >= 35:
                        recommendation = 'sell'
                        recommendation_ar = 'بيع'
                    else:
                        recommendation = 'strong_sell'
                        recommendation_ar = 'بيع قوي'
        except Exception as _bonus_err:
            pass  # Don't crash if bonus fails

        # === FUNDAMENTAL BONUS (يوليو 2026) ===
        # بيجيب fundamentals من data_engine.db (اللي بيتغذّى من TradingView scraper)
        # لو fundamental_score >= 70 → +10 bonus
        # لو >= 60 → +5 bonus
        # لو < 40 → -5 penalty
        _fund_conn = None
        try:
            import sqlite3 as _fund_sql
            from pathlib import Path as _FundPath
            _fund_root = _FundPath(__file__).resolve().parent.parent.parent
            _fund_db = str(_fund_root / 'db' / 'data_engine.db')

            # الأول جرّب egx_fundamentals table (لو موجودة من EGXPilot)
            _fund_conn = _fund_sql.connect(_fund_db)
            _fund_conn.row_factory = _fund_sql.Row
            _fund_row = None
            try:
                _fund_row = _fund_conn.execute(
                    "SELECT fundamental_score, pe_ratio, roe, net_margin, debt_to_equity FROM egx_fundamentals WHERE ticker = ?",
                    (ticker,)
                ).fetchone()
            except Exception as e:
                # Expected when egx_fundamentals table doesn't exist yet — fundamental
                # analysis falls back to technicals only. Downgraded to DEBUG to avoid
                # log spam (this fires for every stock on every analysis cycle).
                logger.debug(f"egx_fundamentals not available for {ticker}: {e}")

            # لو مش موجود، جرّب tab_valuation + tab_profitability (من TradingView)
            if not _fund_row:
                try:
                    _fund_row = _fund_conn.execute(
                        "SELECT v.data as val_data, p.data as prof_data FROM tab_valuation v LEFT JOIN tab_profitability p ON v.symbol = p.symbol WHERE v.symbol LIKE ?",
                        (f"{ticker}%",)
                    ).fetchone()
                except Exception as e:
                    # Same as above — tab_valuation/tab_profitability are optional
                    # TradingView-derived tables. Downgraded to DEBUG.
                    logger.debug(f"tab_valuation/tab_profitability not available for {ticker}: {e}")

            if _fund_row:
                # لو من egx_fundamentals (فيه fundamental_score جاهز)
                if 'fundamental_score' in _fund_row.keys() and _fund_row['fundamental_score']:
                    fund_score = float(_fund_row['fundamental_score'])
                    if fund_score >= 70:
                        maestro_score = max(0, min(100, maestro_score + 10))
                        warnings.append(f'Fundamental score {fund_score:.0f} (+10)')
                    elif fund_score >= 60:
                        maestro_score = max(0, min(100, maestro_score + 5))
                        warnings.append(f'Fundamental score {fund_score:.0f} (+5)')
                    elif fund_score < 40:
                        maestro_score = max(0, min(100, maestro_score - 5))
                        warnings.append(f'Fundamental score {fund_score:.0f} (-5 penalty)')
                # لو من TradingView (tab_valuation + tab_profitability)
                elif 'val_data' in _fund_row.keys() and _fund_row['val_data']:
                    import json as _fund_json
                    try:
                        val_data = _fund_json.loads(_fund_row['val_data']) if isinstance(_fund_row['val_data'], str) else _fund_row['val_data']
                        # tab_valuation: [symbol, market_cap, ..., P/E, P/B, P/S, ...]
                        pe_idx = 3  # index of P/E in tab_valuation array
                        if len(val_data) > pe_idx:
                            pe_str = str(val_data[pe_idx]).replace('—', '').strip()
                            try:
                                pe = float(pe_str)
                                if pe > 0:
                                    if pe < 10:
                                        maestro_score = max(0, min(100, maestro_score + 10))
                                        warnings.append(f'P/E {pe:.1f} رخيص (+10)')
                                    elif pe < 15:
                                        maestro_score = max(0, min(100, maestro_score + 5))
                                        warnings.append(f'P/E {pe:.1f} جيد (+5)')
                                    elif pe > 50:
                                        maestro_score = max(0, min(100, maestro_score - 5))
                                        warnings.append(f'P/E {pe:.1f} غالي (-5)')
                            except ValueError:
                                pass
                    except Exception as e:
                        logger.warning(f"Error parsing val_data for {ticker}: {e}")

        except Exception as e:
            logger.warning(f"Fundamental bonus skipped for {ticker}: {e}")
        finally:
            # 🔒 ضمان إن الـ connection تتقفل (P0 fix يوليو 2026)
            if _fund_conn:
                try:
                    _fund_conn.close()
                except Exception as e:
                    logger.warning(f"Error closing _fund_conn: {e}")

        # Fix entry/sl/target: for sells, target must be below price (consistency rule)
        is_buy = recommendation in ['buy', 'strong_buy', 't1_buy', 'swing_buy']

        # =====================================================================
        # UNIFIED-LOGIC (2026-08-30): Discovery Fallback Chain (3-layer)
        # المنطق الموحد المطلوب من المالك:
        #   1. المحرك الأساسي يطلع الإشارة.
        #   2. لو الإشارة ضعيفة أو WAIT → افحص Volume Surge / Maker.
        #   3. لو مفيش Surge → افحص Accumulation (تجميع هادئ 3 أيام).
        #   4. لو مفيش Accumulation → افحص Recovery from Long Base / Late Correction.
        # الـ 3 detectors موجودة في analyzers/core_scoring_engine.py (بدون ملفات جديدة).
        # التفعيل: لو recommendation مش BUY/STRONG_BUY + في signal قوي من أي detector → رقّي.
        # =====================================================================
        _discovery_fallback_signal = None
        if not is_buy and price_history and len(price_history) >= 20:
            try:
                from analyzers.core_scoring_engine import (
                    detect_volume_surge_rocket as _detect_surge,
                    detect_accumulation_phase as _detect_acc,
                    detect_recovery_from_base as _detect_recovery,
                )
                # بناء OHLCV list للـ detectors
                _ohlcv = []
                for p in price_history[-60:]:
                    _ohlcv.append({
                        'close': float(p.get('close', p.get('close_price', 0)) or 0),
                        'high': float(p.get('high', p.get('high_price', 0)) or 0),
                        'low': float(p.get('low', p.get('low_price', 0)) or 0),
                        'open': float(p.get('open', p.get('open_price', 0)) or 0),
                        'volume': float(p.get('volume', p.get('volume_traded', 0)) or 0),
                    })

                # Layer 1: Volume Surge Hunter
                _surge = _detect_surge(_ohlcv) if len(_ohlcv) >= 20 else None
                if _surge and _surge.get('is_surge_rocket'):
                    _discovery_fallback_signal = ('surge_rocket', _surge)
                    print(f"[FALLBACK-L1] ticker={ticker} Volume Surge Rocket detected "
                          f"(score={_surge.get('score', 0)})", flush=True)

                # Layer 2: Pre-explosion Accumulation
                if not _discovery_fallback_signal:
                    _acc = _detect_acc(_ohlcv) if len(_ohlcv) >= 20 else None
                    if _acc and _acc.get('is_accumulation'):
                        _discovery_fallback_signal = ('accumulation', _acc)
                        print(f"[FALLBACK-L2] ticker={ticker} Accumulation detected "
                              f"(score={_acc.get('score', 0)})", flush=True)

                # Layer 3: Recovery from Long Base
                if not _discovery_fallback_signal:
                    _rec = _detect_recovery(_ohlcv) if len(_ohlcv) >= 30 else None
                    if _rec and _rec.get('is_recovery_signal'):
                        _discovery_fallback_signal = ('recovery', _rec)
                        print(f"[FALLBACK-L3] ticker={ticker} Recovery from Base detected "
                              f"(score={_rec.get('score', 0)})", flush=True)

                # رقّي التوصية لو في signal قوي + الـ entry gate مش مرفوض
                if _discovery_fallback_signal and not _entry_vetoed:
                    _df_kind, _df_data = _discovery_fallback_signal
                    _df_score = float(_df_data.get('score', 0) or 0)
                    if _df_score >= 60:
                        recommendation = 'buy'
                        recommendation_ar = f'شراء ({_df_kind}: score={_df_score:.0f})'
                        is_buy = True
                        maestro_score = max(maestro_score, _df_score)
                        warnings.append(f'Discovery fallback: {_df_kind} (score={_df_score:.0f})')
                        warnings_ar.append(f'سلسلة الاكتشاف: {_df_kind} — رفع التوصية لشراء')
                        print(f"[DISCOVERY-UPGRADE] ticker={ticker} hold→buy "
                              f"({_df_kind}, score={_df_score:.0f})", flush=True)
            except Exception as _df_err:
                logger.debug(f"Discovery fallback chain failed for {ticker}: {_df_err}")

        entry_price = round2(current_price * 0.995) if is_buy else current_price
        
        # Fallback values
        if recommendation == 't1_buy':
            sl_pct, tp_pct = EGX_SIGNAL_PARAMS['t1_buy']['stop_loss_pct'], EGX_SIGNAL_PARAMS['t1_buy']['target_pct']
        elif recommendation == 'swing_buy':
            sl_pct, tp_pct = EGX_SIGNAL_PARAMS['swing_buy']['stop_loss_pct'], EGX_SIGNAL_PARAMS['swing_buy']['target_pct']
        else:
            # 🧠 الخبير الجديد: وقف -8% وهدف +10%
            sl_pct, tp_pct = 8.0, 10.0
            
        if is_buy:
            stop_loss = round2(entry_price * (1 - sl_pct / 100))
            target = round2(entry_price * (1 + tp_pct / 100))
        else:
            # For sells: stop above, target below
            stop_loss = round2(entry_price * (1 + sl_pct / 100))
            target = round2(entry_price * (1 - tp_pct / 100))

        # =====================================================================
        # 🔥 P0-v7 TASK #1 (MISSED UPSIDE FEEDBACK LOOP):
        # اقرأ السجل الانفجاري التاريخي للسهم (highest_price_reached من
        # predictions + MISSED_BREAKOUT من learned_lessons). لو السهم "انفجاري
        # تاريخياً" (max_upside ≥ 15% OR missed_breakout ≥ 2) → فعّل Uncap Targets
        # بـ force _mom_is_momentum=True. ده بـ يـ let it run لـ +50%/+100% بدل
        # ما يـ cap عند +3%.
        # =====================================================================
        _p07_explosive = None
        try:
            from utils.lesson_store import get_ticker_explosive_history
            _p07_explosive = get_ticker_explosive_history(ticker, days=90)
            if _p07_explosive and _p07_explosive.get('is_explosive'):
                print(f"[MISSED_UPSIDE] ticker={ticker} EXPLOSIVE — "
                      f"{_p07_explosive.get('reason')} → force Uncap Targets", flush=True)
                warnings.append(f"سهم انفجاري تاريخياً: {_p07_explosive.get('reason')}")
                warnings_ar.append(f"السهم له سجل انفجاري: {_p07_explosive.get('reason')}")
                # boost maestro_score لو فيه missed_breakout (تعويض عن الفرص الضائعة)
                _mb_count = int(_p07_explosive.get('missed_breakout_count', 0) or 0)
                if _mb_count >= 2:
                    _mb_boost = min(10, _mb_count * 3)  # +3 per missed, cap +10
                    maestro_score = max(0, min(100, maestro_score + _mb_boost))
                    print(f"[MISSED_UPSIDE] ticker={ticker} +{_mb_boost} score boost "
                          f"(missed_breakout ×{_mb_count})", flush=True)
        except Exception as _p07_eh_err:
            print(f"[MISSED_UPSIDE] ticker={ticker} explosive history read failed: {_p07_eh_err}")

        # =====================================================================
        # 🔥 P0-v7 TASK #4 (CLOSED-LOOP LEARNING): قراءة optimizer_params.json
        # عشان الـ R:R enforcement و volume_spike_mult يستخدموا القيم اللي
        # الـ learning loop كتبها (من weekly_market_adjustment.py أو الأدمن).
        # بدون ده، الـ params بتتبقى cached ومش بـ تأثر على القرار.
        # =====================================================================
        _p07_opt_params = None
        try:
            from api.optimizer_params_routes import get_optimizer_params
            _p07_opt_params = get_optimizer_params()
        except Exception:
            _p07_opt_params = None

        # ── initialize momentum defaults (fix latent NameError if DYNAMIC_TARGET
        #    block fails before _mom_is_momentum is assigned) ──
        _mom_change_pct = 0.0
        _mom_is_breakout = False
        _mom_is_momentum = False

        # Dynamic target and stop loss based on technical analysis (S/R, Swing High/Low, ATR, Fibonacci)
        # MOMENTUM-ESCALATION (v3.63.0): تفعيل نمط trend_following + تمرير volume
        # لما السهم فيه زخم انفجاري (volume_ratio >= 1.8 + change_pct >= 3.0 أو breakout)،
        # نفعّل mode='trend_following' اللي بيـ use ATR-based trailing stop وأوسع targets.
        # الكود ده كان ميت قبل كده (الـ call ما كانش بيمرر volume/mode → default mean_reversion).
        if DYNAMIC_TARGET_AVAILABLE:
            try:
                target_engine = DynamicTargetEngine(price_history_db=PRICE_HISTORY_DB, stocks_db=self.db_path)
                current_persona = 'balanced'
                if recommendation == 't1_buy':
                    current_persona = 'active_trader'
                elif recommendation == 'swing_buy':
                    current_persona = 'balanced'

                # MOMENTUM-ESCALATION: حساب volume + volume_sma_20 + change_pct للـ mode
                _mom_volume = None
                _mom_volume_sma_20 = None
                try:
                    _mom_volume = float(volume_phase.current_volume) if volume_phase else None
                    _mom_volume_sma_20 = float(volume_phase.avg_volume_20) if volume_phase and volume_phase.avg_volume_20 > 0 else None
                except Exception:
                    pass
                # change_pct من price_history (آخر يومين)
                _mom_change_pct = 0.0
                try:
                    if price_history and len(price_history) >= 2:
                        _ph_last = float(price_history[-1].get('close', price_history[-1].get('close_price', 0)) or 0)
                        _ph_prev = float(price_history[-2].get('close', price_history[-2].get('close_price', 0)) or 0)
                        if _ph_prev > 0:
                            _mom_change_pct = ((_ph_last - _ph_prev) / _ph_prev) * 100
                except Exception:
                    _mom_change_pct = 0.0

                # breakout: السهم كسر أعلى سعر في آخر 20 يوم (current_price >= high_20d * 0.99)
                _mom_is_breakout = False
                try:
                    if price_history and len(price_history) >= 5 and current_price > 0:
                        _recent_highs = [float(p.get('high', p.get('high_price', 0)) or 0) for p in price_history[-20:]]
                        _recent_highs = [h for h in _recent_highs if h > 0]
                        if _recent_highs:
                            _high_20d = max(_recent_highs)
                            _mom_is_breakout = current_price >= _high_20d * 0.99
                except Exception:
                    _mom_is_breakout = False

                # تفعيل trend_following لما فيه زخم انفجاري
                # 🔥 P0-v7 TASK #4: volume_spike_mult من optimizer_params.json
                #    (default 1.8) — الـ learning loop يقدر يخفضها لو الأسواق هادية.
                _p07_vr_threshold = 1.8
                if _p07_opt_params:
                    try:
                        _p07_vr_threshold = float(_p07_opt_params.get('volume_spike_mult', 1.8) or 1.8)
                    except (TypeError, ValueError):
                        _p07_vr_threshold = 1.8
                # 🔥 P0-v7 TASK #1: لو السهم انفجاري تاريخياً → force momentum=True
                _p07_explosive_force = bool(
                    _p07_explosive and _p07_explosive.get('is_explosive')
                )
                _mom_is_momentum = (
                    (volume_ratio is not None and float(volume_ratio) >= _p07_vr_threshold and _mom_change_pct >= 3.0)
                    or _mom_is_breakout
                    or _p07_explosive_force  # ← P0-v7: explosive history → uncap
                )
                _mom_mode = 'trend_following' if _mom_is_momentum else 'mean_reversion'

                target_result = target_engine.calculate(
                    ticker=ticker,
                    entry_price=entry_price,
                    score=maestro_score,
                    persona=current_persona,
                    price_history=price_history,
                    volume=_mom_volume,
                    volume_sma_20=_mom_volume_sma_20,
                    mode=_mom_mode,
                )
                if target_result and target_result.stop_loss > 0 and target_result.target_price > 0:
                    if is_buy:
                        stop_loss = round2(target_result.stop_loss)
                        target = round2(target_result.target_price)
                        _mom_tag = ' [MOMENTUM/trend_following]' if _mom_is_momentum else ''
                        print(f"[MaestroOrchestrator] Dynamic technical levels used for {ticker}: stop={stop_loss}, target={target} (basis stop={target_result.stop_basis}, target={target_result.target_basis}){_mom_tag}")
            except Exception as te_e:
                print(f"[MaestroOrchestrator] Failed to calculate dynamic target/stop for {ticker}: {te_e}")

        # =====================================================================
        # P24-ADAPTIVE-RR (Aug 2026): Adaptive Stop/Target from persona+regime+vol.
        # ---------------------------------------------------------------------
        # بدل ما تكون الـ Targets و Stops ثابتة (1.5R/3.0R)، بنحسب مضاعفات ATR
        # ديناميكية من: persona (gambler يطمع) + regime (صاعد يوسّع) + volatility.
        # القاعدة: gambler + vol>80% → R/R 2.2/4.5.
        #
        # كمان بنستخدم أقرب Order Block كـ Surgical Stop (مش بس ATR×1.5) — لو فيه
        # bullish OB تحت السعر، الستوب يتحط تحت قاع الـ OB (وقف جراحي حقيقي).
        # =====================================================================
        _adaptive_rr_used = False
        # P26-PERSONA-SEPARATION: بنهيّئ المتغيرات المشتركة قبل الـ adaptive_rr
        # block عشان الـ persona override (تحت) يقدر يستخدمها حتى لو الـ adaptive_rr
        # ما اشتغلش (مثلاً لو الإشارة مش BUY).
        _atr_val = 0.0
        _vol_pct = 0.0
        _p25_profile = None
        if ADAPTIVE_RR_AVAILABLE and is_buy and entry_price > 0:
            try:
                # حساب ATR و volatility_percentile من price_history
                _ph_closes = [to_num(p.get('close', p.get('close_price', 0))) for p in price_history]
                _ph_closes = [c for c in _ph_closes if c > 0]
                _ph_highs = [to_num(p.get('high', p.get('high_price', 0))) for p in price_history]
                _ph_lows = [to_num(p.get('low', p.get('low_price', 0))) for p in price_history]
                _atr_val = 0.0
                if len(_ph_closes) >= 15 and len(_ph_highs) >= 15 and len(_ph_lows) >= 15:
                    _n = min(len(_ph_closes), len(_ph_highs), len(_ph_lows))
                    _trs = []
                    for _i in range(1, _n):
                        _pc = _ph_closes[_i - 1]
                        if _pc <= 0:
                            continue
                        _tr = max(_ph_highs[_i] - _ph_lows[_i],
                                  abs(_ph_highs[_i] - _pc),
                                  abs(_ph_lows[_i] - _pc))
                        _trs.append(_tr)
                    if _trs:
                        _window = _trs[-14:] if len(_trs) >= 14 else _trs
                        _atr_val = sum(_window) / len(_window)
                # volatility_percentile = ATR/price * 100
                _vol_pct = (_atr_val / entry_price * 100.0) if (entry_price > 0 and _atr_val > 0) else 3.0

                # persona للـ adaptive_rr: gambler لو الـ persona_type gambler/active_trader
                _rr_persona = 'balanced'
                if persona_type in ('gambler', 'active_trader'):
                    _rr_persona = 'gambler'
                elif persona_type in ('conservative', 'investor'):
                    _rr_persona = 'conservative'

                # regime: نجيب phase الـ regime detector
                _rr_regime = regime_phase.phase if regime_phase else 'range'
                # rich regime: لو bull و volume_ratio عالي → strong_bull
                if _rr_regime == 'bull' and volume_ratio >= 1.8:
                    _rr_regime = 'strong_bull'

                # P25-LIVING-ENGINE: اقرأ ملف تعريف السهم (Stock DNA) عشان
                # adaptive_rr يستخدم avg_atr_pct + reaction_to_market_crashes.
                _p25_profile = None
                try:
                    from analyzers.stock_dna_analyzer import get_stock_profile
                    _p25_profile = get_stock_profile(ticker)
                except Exception:
                    _p25_profile = None

                _rr = _adaptive_rr(
                    ticker=ticker, atr=_atr_val,
                    volatility_percentile=_vol_pct,
                    persona=_rr_persona, regime=_rr_regime,
                    stock_profile=_p25_profile,
                )
                if _rr and _rr.get('stop_atr_mult'):
                    _stop_mult = _rr['stop_atr_mult']
                    _target_mult = _rr['target_atr_mult']
                    # Surgical Stop: لو فيه bullish Order Block تحت السعر، نحط الستوب
                    # تحت قاع الـ OB (وقف جراحي حقيقي بدل ATR×1.5).
                    _ob_stop = None
                    try:
                        # بنقرأ الـ OB zones من master_analyzer لو متاح (تم حسابها في SMC blend)
                        _ma = getattr(self, 'master_analyzer', None)
                        if _ma and hasattr(_ma, '_last_smc_ob_zones'):
                            _ob_zones = _ma._last_smc_ob_zones or []
                            for _ob in _ob_zones:
                                if _ob.get('type') == 'bullish_ob':
                                    _ob_bottom = float(_ob.get('bottom', 0))
                                    if 0 < _ob_bottom < entry_price:
                                        # الستوب تحت قاع الـ OB بـ 0.5%
                                        _candidate = _ob_bottom * 0.995
                                        if _ob_stop is None or _candidate > _ob_stop:
                                            _ob_stop = _candidate
                    except Exception:
                        _ob_stop = None

                    # الوقف النهائي: الأضيق بين (ATR-based) و (OB-based)
                    _atr_stop = entry_price - (_atr_val * _stop_mult) if _atr_val > 0 else entry_price * (1 - 0.08)
                    if _ob_stop and _ob_stop > _atr_stop and _ob_stop < entry_price:
                        _final_stop = _ob_stop
                        _stop_method = 'OB_SURGICAL'
                    else:
                        _final_stop = _atr_stop
                        _stop_method = 'ATR_ADAPTIVE'

                    # الهدف: ATR × target_mult (أو المقاومة لو أوسع)
                    _atr_target = entry_price + (_atr_val * _target_mult) if _atr_val > 0 else entry_price * (1 + 0.10)
                    # لو الـ target الحالي (من DynamicTargetEngine/S/R) أوسع، نفضّله
                    if target > entry_price and target >= _atr_target:
                        _final_target = target
                    else:
                        _final_target = _atr_target

                    stop_loss = round2(_final_stop)
                    target = round2(_final_target)
                    _adaptive_rr_used = True
                    _crash_tag = _rr.get('crash_class', 'unknown') if _rr else 'unknown'
                    print(f"[MaestroOrchestrator] P25-ADAPTIVE-RR for {ticker}: "
                          f"persona={_rr_persona}, regime={_rr_regime}, vol={_vol_pct:.1f}%, "
                          f"crash={_crash_tag} → "
                          f"stop={stop_loss} ({_stop_method}, mult={_stop_mult}), "
                          f"target={target} (mult={_target_mult})")
            except Exception as _arr_err:
                print(f"[MaestroOrchestrator] P24 adaptive_rr failed for {ticker}: {_arr_err}")

        # =====================================================================
        # P26-PERSONA-SEPARATION (Aug 2026): Persona-specific target/stop.
        # ---------------------------------------------------------------------
        # ده الحل الجذري لمشكلة "المضارب = المستثمر نفس النتيجة". بدل ما الـ
        # entry/target/stop الموحّد هو اللي بيتحفظ، بنعمل OVERWRITE بالقيم
        # الخاصة بكل persona:
        #   - gambler:      +3%..+6% target, -2%..-3% stop   (1-5 أيام)
        #   - balanced:     +8%..+14% target, -5%..-7% stop   (2-6 أسابيع)
        #   - conservative: +20%..+35% target, -10%..-15% stop (6-12 شهر)
        # النسبة المضبوطة جوه النطاق بتتحدد بالتذبذب. مفيش Fallback موحّد — كل
        # persona ليها أرقامها الخاصة المختلفة جذرياً.
        #
        # MOMENTUM-UNCAP (v3.63.0): لما السهم فيه زخم انفجاري (volume_ratio >= 2.0
        # + change_1w >= 8.0)، بنمرر volume_ratio + change_1w_pct لـ compute_persona_rr_overrides
        # عشان تفك الـ Caps وتدي أهداف أوسع (gambler حتى +30%, balanced حتى +50%).
        # =====================================================================
        # حساب change_1w_pct من price_history (آخر 7 أيام)
        _p26_change_1w_pct = 0.0
        try:
            if price_history and len(price_history) >= 8:
                _ph_last_w = float(price_history[-1].get('close', price_history[-1].get('close_price', 0)) or 0)
                _ph_prev_w = float(price_history[-8].get('close', price_history[-8].get('close_price', 0)) or 0)
                if _ph_prev_w > 0:
                    _p26_change_1w_pct = ((_ph_last_w - _ph_prev_w) / _ph_prev_w) * 100
        except Exception:
            _p26_change_1w_pct = 0.0
        # P26-PERSONA-RR: نطبّق override للإشارات الشرائية والانتظار بس.
        # 🔥 P0-v6 FIX #1 (MOMENTUM-UNCAP-GUARD): لما السهم في وضع momentum
        #    (vr≥1.8 + chg_1d≥3% OR breakout)، لازم نـ SKIP الـ P26 override
        #    ونخلي الـ structural-resistance target من DynamicTargetEngine يعيش.
        #    قبل كده، P26 كان بيـ overwrite الـ target بـ band cap (+6% gambler)
        #    حتى لو الـ structural-resistance target كان +25% → المضارب بيفوّت
        #    الأسهم اللي بتعمل +50%/+100%.
        _SELL_SIGNALS_P26 = ('sell', 'strong_sell', 'reduce')
        _persona_rr_all = None
        _p26_skip_momentum = _mom_is_momentum  # ← FIX #1: skip P26 لو momentum
        if (PERSONA_RR_AVAILABLE and entry_price > 0 and persona_type
                and recommendation not in _SELL_SIGNALS_P26
                and not _p26_skip_momentum):
            try:
                # لو الـ adaptive_rr ما اشتغلش (إشارة مش BUY)، نحمّل الـ profile هنا.
                if _p25_profile is None:
                    try:
                        from analyzers.stock_dna_analyzer import get_stock_profile
                        _p25_profile = get_stock_profile(ticker)
                    except Exception:
                        _p25_profile = None
                # B3 (Closed-Loop): اقرأ ملخص دروس كل شخصية مرة واحدة، عشان
                # compute_persona_rr_overrides يطبّق تعديل محدود على الوقف لو
                # فيه تكرار STOP_TOO_TIGHT. التعديل محصور (max +40%) ومستمد
                # من الدروس الحقيقية — مش أوزان سحرية.
                _p26_lesson_summaries = {}
                try:
                    from utils.lesson_store import get_persona_lesson_summary
                    for _pk in ('gambler', 'balanced', 'conservative'):
                        _p26_lesson_summaries[_pk] = get_persona_lesson_summary(_pk, days=30)
                except Exception:
                    pass
                # Phase 2 (V40): احسب المقاومة الهيكلية التالية من SMC OB zones.
                # Bearish Order Blocks = مقاومة. لو explosive_uncap شغال،
                # الهدف يتحول لأقرب مقاومة هيكلية فوق السعر بدل نسبة ثابتة.
                _p26_structural_resistance = 0.0
                try:
                    _ma_sr = getattr(self, 'master_analyzer', None)
                    if _ma_sr and hasattr(_ma_sr, '_last_smc_ob_zones'):
                        for _ob_sr in (_ma_sr._last_smc_ob_zones or []):
                            if _ob_sr.get('type') == 'bearish_ob':
                                _ob_top_sr = float(_ob_sr.get('top', 0))
                                if _ob_top_sr > entry_price:
                                    if _p26_structural_resistance == 0 or _ob_top_sr < _p26_structural_resistance:
                                        _p26_structural_resistance = _ob_top_sr
                except Exception:
                    _p26_structural_resistance = 0.0

                # P26: احسب R/R للشخصية المطلوبة (ده اللي بيتحفظ في الأعمدة).
                # MOMENTUM-UNCAP: نمرر volume_ratio + change_1w_pct عشان تفك الـ Caps لو الزخم انفجاري.
                # Phase 2: نمرر structural_resistance عشان الهدف يتحول للمقاومة لو explosive.
                # P4: نمرر volume_dryup_confirmed عشان Guard 4 (Fakeout prevention).

                # ── P4-VOLUME-DRYUP: جفاف الحجم كشرط للاختراق الحقيقي ──
                # فلسفة ليفرمور: السهم اللي حجمه ما جفش قبل الاختراق ده fakeout.
                # لازم آخر 3 شموع (قبل الإشارة) يكون متوسط حجمها < 50% من avg_volume_20.
                _p26_volume_dryup = None  # None = data unavailable → permissive
                try:
                    if price_history and len(price_history) >= 23:
                        # آخر 3 شموع قبل الإشارة (استثني شمعة الإشارة نفسها)
                        _dryup_vols = []
                        for _dv in price_history[-4:-1]:  # candles [-4], [-3], [-2]
                            _vv = parse_volume(_dv.get('volume', 0))
                            if _vv > 0:
                                _dryup_vols.append(_vv)
                        if _dryup_vols:
                            _avg_dryup = sum(_dryup_vols) / len(_dryup_vols)
                            # avg_volume_20 من آخر 20 شمعة (قبل الـ 3)
                            _vol_20_candles = [parse_volume(_vh.get('volume', 0))
                                               for _vh in price_history[-23:-3]
                                               if parse_volume(_vh.get('volume', 0)) > 0]
                            if _vol_20_candles:
                                _avg_vol_20 = sum(_vol_20_candles) / len(_vol_20_candles)
                                if _avg_vol_20 > 0:
                                    _dryup_ratio = _avg_dryup / _avg_vol_20
                                    _p26_volume_dryup = _dryup_ratio < 0.50  # True=confirmed, False=fakeout
                except Exception:
                    _p26_volume_dryup = None

                _p26_rr = _compute_persona_rr(
                    persona_type=persona_type, entry_price=entry_price,
                    atr=_atr_val, vol_pct=_vol_pct,
                    stock_profile=_p25_profile,
                    volume_ratio=float(volume_ratio or 0.0),
                    change_1w_pct=_p26_change_1w_pct,
                    lesson_summary=_p26_lesson_summaries.get(persona_type),
                    change_1d_pct=_mom_change_pct,          # ← FIX #3: pass 1d change
                    is_breakout=_mom_is_breakout,            # ← FIX #3: pass breakout flag
                    structural_resistance=_p26_structural_resistance,  # ← Phase 2: structural target
                    sector_status=_cl7_status,              # ← Phase 3: Sector Heat Veto
                    market_regime=regime_phase.phase if regime_phase else 'range',  # ← Phase 3: Market Breadth Guard
                    volume_dryup_confirmed=_p26_volume_dryup,  # ← P4: Volume Dry-up Guard
                )
                if _p26_rr and _p26_rr.get('target') and _p26_rr.get('stop'):
                    target = round2(_p26_rr['target'])
                    stop_loss = round2(_p26_rr['stop'])
                    _mom_tag = ' [MOMENTUM-UNCAP]' if _p26_rr.get('momentum_uncap') else ''
                    _lesson_tag = ' [LESSON-EXPAND]' if 'lesson_expand' in (_p26_rr.get('method') or '') else ''
                    # Phase 3: Log veto reasons + wash trading flag
                    _veto_tag = ''
                    if _p26_rr.get('uncap_veto_reasons'):
                        _veto_tag = ' [VETO:' + ','.join(_p26_rr['uncap_veto_reasons']) + ']'
                    _wash_tag = ' [WASH-TRADING]' if _p26_rr.get('is_wash_trading') else ''
                    print(f"[MaestroOrchestrator] P26-PERSONA-RR for {ticker}: "
                          f"persona={_p26_rr['persona']}, horizon={_p26_rr['horizon']}, "
                          f"target={target} (+{_p26_rr['target_pct']}%), "
                          f"stop={stop_loss} (-{_p26_rr['stop_pct']}%){_mom_tag}{_lesson_tag}{_veto_tag}{_wash_tag}")
                # P26: احسب R/R للـ 3 شخصيات كلها وخزّنها عشان الواجهة تقدر
                # تبدّل بينهم وتشوف أرقام مختلفة فوراً (من غير إعادة تحليل).
                _persona_rr_all = {}
                for _persona_key in ('gambler', 'balanced', 'conservative'):
                    _prr = _compute_persona_rr(
                        persona_type=_persona_key, entry_price=entry_price,
                        atr=_atr_val, vol_pct=_vol_pct,
                        stock_profile=_p25_profile,
                        volume_ratio=float(volume_ratio or 0.0),
                        change_1w_pct=_p26_change_1w_pct,
                        lesson_summary=_p26_lesson_summaries.get(_persona_key),
                        change_1d_pct=_mom_change_pct,      # ← FIX #3
                        is_breakout=_mom_is_breakout,        # ← FIX #3
                        structural_resistance=_p26_structural_resistance,  # ← Phase 2
                        sector_status=_cl7_status,          # ← Phase 3: Sector Heat Veto
                        market_regime=regime_phase.phase if regime_phase else 'range',  # ← Phase 3: Market Breadth Guard
                        volume_dryup_confirmed=_p26_volume_dryup,  # ← P4: Volume Dry-up Guard
                    )
                    if _prr:
                        _persona_rr_all[_persona_key] = _prr
            except Exception as _p26_err:
                print(f"[MaestroOrchestrator] P26 persona_rr failed for {ticker}: {_p26_err}")

        risk_reward = round2((target - entry_price) / (entry_price - stop_loss)) if entry_price != stop_loss else 0

        # STRATEGY-041-FIX: Live Trailing Stop (على إغلاق شمعة 5 دقايق، مش كل Tick)
        # المشكلة: لو الستوب بيشتغل على كل Tick، المضارب يضربه بالـ Wick ويرجع يطلع.
        # الحل: نستخدم الـ Close Price (مش الـ High/Low) في حساب الـ gain_pct.
        # الـ Close Price ده سعر إغلاق آخر شمعة (5m أو daily) — مش السعر اللحظي.
        # كده المضارب ما يقدرش يضرب الستوب بالـ Tick الوهمي.
        #
        # القواعد:
        # - لو السهم طلع 5% (على الـ Close) → الستوب يرفع لـ "entry + 1%" (Break-even)
        # - لو السهم طلع 10% (على الـ Close) → الستوب يرفع لـ "highest_close - 3%"
        # - لو السهم طلع 15%+ (على الـ Close) → الستوب يرفع لـ "highest_close - 2%"
        trailing_stop = stop_loss
        trailing_logic = ''
        try:
            # نحسب أعلى سعر إغلاق من price_history (آخر 5 أيام)
            # STRATEGY-041-FIX: نستخدم close مش high (عشان نتجنب الـ Wick)
            if price_history and len(price_history) > 0:
                recent_closes = [float(h.get('close', h.get('close_price', 0)) or 0) for h in price_history[:5]]
                recent_closes = [c for c in recent_closes if c > 0]
                highest_close = max(recent_closes) if recent_closes else current_price
            else:
                highest_close = current_price

            if is_buy and entry_price > 0:
                # STRATEGY-041-FIX: gain_pct على الـ Close (مش الـ current_price اللحظي)
                # عشان المضارب ما يضربش الستوب بالـ Tick
                gain_pct = ((highest_close - entry_price) / entry_price) * 100
                # 🔥 P0-v6 FIX #7 (TRAILING-50%-OF-PROFIT):
                #    المالك طلب "Trailing 50%" — الـ trailing stop يبقى عند
                #    entry + (highest - entry) × 0.5 = 50% من الربح محفوظ دايماً.
                #    ده بـ يـ let it run: السهم لو طار لـ +100%، الستوب يبقى عند +50%.
                #    قبل كده كان tier ladder (5%→BE, 10%→-3%, 15%→-2%) بـ CAP الربح
                #    عند ~15% ويباع السهم بسرعة → بيفوّت الـ +50%/+100%.
                #    القاعدة الجديدة: من +5% gain، trail 50% of profit (ratchet up).
                if gain_pct >= 5:
                    profit_per_share = highest_close - entry_price
                    trailing_stop = round2(entry_price + profit_per_share * 0.50)
                    trailing_logic = (
                        f'وقف متحرك 50% من الربح: entry ({entry_price:.2f}) + '
                        f'(highest ({highest_close:.2f}) - entry) × 0.5 = {trailing_stop:.2f} '
                        f'(حافظ 50% من ربح +{gain_pct:.1f}%)'
                    )
                else:
                    # السهم لسه ما طلعش 5% → الوقف الأساسي
                    trailing_logic = (
                        f'وقف أساسي: {stop_loss:.2f} (تحت الدعم) — '
                        f'الـ trailing 50% هـ يبدأ بعد +5% إغلاق'
                    )
        except Exception as _ts_e:
            logger.debug(f"Trailing stop calc failed: {_ts_e}")
            trailing_logic = ''

        # POSITION-SIZING-024: حساب suggested_position_size_pct من risk_profile
        # (entry, stop) + portfolio_value (لو متاح في options).
        # المعادلة:
        #   risk_amount = portfolio_value * 0.02   (2% من المحفظة = أقصى خسارة)
        #   risk_per_share = entry - stop
        #   shares = risk_amount / risk_per_share
        #   position_value = shares * entry
        #   suggested_pct = (position_value / portfolio_value) * 100
        # القواعد: 5% حد أقصى للسهم الواحد، 30% حد أقصى للتعرض الكلي.
        suggested_position_size_pct = None
        position_warning = None
        portfolio_value_opt = options.get('portfolio_value') if isinstance(options, dict) else None
        try:
            pv = float(portfolio_value_opt) if portfolio_value_opt is not None else None
        except (TypeError, ValueError):
            pv = None

        if pv and pv > 0 and is_buy and entry_price > stop_loss:
            risk_amount = pv * 0.02
            risk_per_share = entry_price - stop_loss
            if risk_per_share > 0:
                shares = risk_amount / risk_per_share
                position_value = shares * entry_price
                pct = (position_value / pv) * 100
                # cap 5% per ticker
                if pct > 5.0:
                    pct = 5.0
                # cap 30% total exposure (نستخدم existing exposure لو متاح في options)
                existing_exposure_pct = float(options.get('existing_exposure_pct', 0) or 0)
                if (existing_exposure_pct + pct) > 30.0:
                    pct = max(0.0, 30.0 - existing_exposure_pct)
                suggested_position_size_pct = round(pct, 2)

                # تحذير لو السيولة المتاحة أقل من حجم الصفقة
                available_cash_opt = options.get('available_cash')
                try:
                    available_cash_val = float(available_cash_opt) if available_cash_opt is not None else None
                except (TypeError, ValueError):
                    available_cash_val = None
                if available_cash_val is not None:
                    required_value = pv * (pct / 100.0)
                    if available_cash_val < required_value:
                        position_warning = (
                            f"سيولة غير كافية - انتظر تسوية T+2 "
                            f"(مطلوب {required_value:.2f}، متاح {available_cash_val:.2f})"
                        )

        rsi = 50.0
        if len(closes) >= 15:
            gains, losses = [], []
            for i in range(1, min(15, len(closes))):
                change = closes[-i] - closes[-i-1]
                if change > 0:
                    gains.append(change)
                else:
                    losses.append(abs(change))
            avg_gain = sum(gains) / 14 if gains else 0
            avg_loss = sum(losses) / 14 if losses else 0.001
            rsi = 100 - (100 / (1 + avg_gain / avg_loss))

        expert_memory = run_expert_memory_phase(self.db_path, ticker, stock.get('sector', 'Other'), regime_phase.phase, rsi, datetime.now().month, stock.get('personality'), persona_type)

        # 🔥 VERIFY-RL: default exit policy — يتم تحديثها لـ 'multi_target' لو
        # الـ persona عندها win-side bias (target_raise أو holdthrough).
        _rl_exit_policy = 'fixed'

        if expert_memory.recommendation == 'block' and recommendation in ['buy', 'strong_buy']:
            recommendation = 'hold'
            warnings.append(f'Expert memory BLOCKED: {expert_memory.reason}')
            warnings_ar.append(f'الذاكرة الخبيرة منعت: {expert_memory.reason}')
        elif expert_memory.recommendation == 'caution' and recommendation in ['buy', 'strong_buy']:
            confidence = max(0, min(100, confidence - 10))
            warnings.append(f'Expert memory CAUTION: {expert_memory.reason}')
            warnings_ar.append(f'الذاكرة الخبيرة تحذر: {expert_memory.reason}')
        elif expert_memory.recommendation == 'boost':
            confidence = max(0, min(100, confidence + expert_memory.confidence_adjustment))
            if expert_memory.found_similar:
                warnings.append(f'Expert memory BOOST: {expert_memory.reason}')
                warnings_ar.append(f'الذاكرة الخبيرة تعزز: {expert_memory.reason}')
        elif expert_memory.confidence_adjustment != 0:
            confidence = max(0, min(100, confidence + expert_memory.confidence_adjustment))

        persona = apply_persona_refinement(maestro_score, recommendation, persona_type, entry_price, stop_loss, target)
        if regime_phase.phase == 'bear':
            warnings.append('Market is in bear regime - reduce position sizes')
            warnings_ar.append('السوق في حالة هبوط - قلل أحجام المراكز')
        if volume_phase.liquidity_rating == 'low':
            warnings.append('Low liquidity - difficulty in execution')
            warnings_ar.append('سيولة منخفضة - صعوبة في التنفيذ')

        # === 🔥 DEEPER BUY RATIONALE (2026-08-17) ===
        # العميل بيسأل "ليه أشتري؟" — لازم النظام يدي سبب واضح ومفصل.
        # نبني rationale شامل من كل الـ phases اللي اتعدّت:
        # 1. الإطار العام (regime): السوق في أي مرحلة؟
        # 2. التذبذب الزمني (timeframe): الإطارات متوافقة؟
        # 3. السيولة (volume): حجم التداول كافي؟
        # 4. المخاطر (risk): R/R مناسب؟
        # 5. الدخول/الهدف/الوقف: مستويات واضحة؟
        if recommendation in ('buy', 'strong_buy'):
            _rationale_parts = []

            # 1. Market regime
            _regime_phase_ar = {
                'bull': 'صاعد', 'bear': 'هابط', 'ranging': 'متذبذب',
                'accumulation': 'تجميع', 'markup': 'تصاعد', 'distribution': 'توزيع',
            }.get(regime_phase.phase, regime_phase.phase)
            _rationale_parts.append(f'السوق {_regime_phase_ar} (ثقة {regime_phase.confidence:.0%})')

            # 2. Timeframe alignment
            if timeframe_phase.aligned:
                _rationale_parts.append(f'الإطارات متوافقة ({timeframe_phase.aligned_count} مؤشرات)')
            else:
                _rationale_parts.append(f'الإطارات غير متوافقة تماماً ({timeframe_phase.aligned_count} مؤشرات)')

            # 3. Volume / liquidity
            if volume_phase.volume_ratio and volume_phase.volume_ratio > 1.5:
                _rationale_parts.append(f'حجم تداول مرتفع ({volume_phase.volume_ratio:.1f}× المعدل)')
            elif volume_phase.liquidity_rating == 'high':
                _rationale_parts.append('سيولة عالية')
            elif volume_phase.liquidity_rating == 'medium':
                _rationale_parts.append('سيولة متوسطة')

            # 4. Risk/Reward
            if risk_reward and risk_reward >= 1.5:
                _rationale_parts.append(f'عائد/مخاطرة = {risk_reward:.1f} (ممتاز)')
            elif risk_reward and risk_reward >= 1.0:
                _rationale_parts.append(f'عائد/مخاطرة = {risk_reward:.1f}')

            # 5. Entry / Target / Stop
            if entry_price and target and stop_loss:
                _upside_pct = ((target - entry_price) / entry_price) * 100
                _downside_pct = ((stop_loss - entry_price) / entry_price) * 100
                _rationale_parts.append(f'الدخول {entry_price:.2f} ← الهدف {target:.2f} (+{_upside_pct:.1f}%) / الوقف {stop_loss:.2f} ({_downside_pct:.1f}%)')

            # 6. Confidence + Score
            _rationale_parts.append(f'درجة الثقة {confidence:.0f}% / النقاط {maestro_score:.0f}')

            # Build final rationale
            _buy_rationale = ' · '.join(_rationale_parts)
            warnings_ar.insert(0, f'📋 سبب التوصية: {_buy_rationale}')
            warnings.insert(0, f'Recommendation rationale: {_buy_rationale}')

        result = MaestroResult(ticker=ticker, timestamp=datetime.now().isoformat(), maestro_score=maestro_score, recommendation=recommendation, recommendation_ar=recommendation_ar, confidence=confidence, entry_price=entry_price, stop_loss=stop_loss, target=target, risk_reward=risk_reward, phases={'regime': {'phase': regime_phase.phase, 'confidence': regime_phase.confidence, 'score': regime_phase.score, 'signals': regime_phase.signals}, 'timeframe': {'confluence_score': timeframe_phase.confluence_score, 'aligned': timeframe_phase.aligned, 'aligned_count': timeframe_phase.aligned_count, 'daily_trend': timeframe_phase.daily_trend, 'signals': timeframe_phase.signals}, 'volume': {'liquidity_rating': volume_phase.liquidity_rating, 'volume_ratio': volume_phase.volume_ratio, 'volume_above_avg': volume_phase.volume_above_avg, 'signals': volume_phase.signals}, 'news': {'has_news': news_phase.has_news, 'has_cbe_news': news_phase.has_cbe_news, 'should_hold': news_phase.should_hold, 'risk_level': news_phase.risk_level, 'signals': news_phase.signals}}, persona=persona, warnings=warnings, warnings_ar=warnings_ar, expert_memory=expert_memory, human_context=human_context, human_personas=human_personas, human_narrative=human_narrative, gambler=gambler_dict, investor=investor_dict, persona_narrative=persona_narrative, suggested_position_size_pct=suggested_position_size_pct, position_warning=position_warning, trailing_stop=trailing_stop, trailing_logic=trailing_logic, persona_rr=_persona_rr_all)

        # ── CL5 (Persona Auto-Classification): وسّم persona تلقائياً ──────
        # المشكلة: المسار المجدول (background_analyzer/market_scheduler) بـ
        # يمرّر options={} → persona_type='balanced' دايماً → كل التوقعات
        # متوازنة → أقسام المضارب/المستثمر فاضية في شاشة المتابعة.
        #
        # الحل (مرحلتين):
        #   (1) جرّب الـ strict gates (is_gambler/investor/balanced_opportunity).
        #       دي بـ تعتمد على fundamentals (pe_ratio/roe/turnover_egp) اللي
        #       ناقصة لـ 1036/1039 سهم EGX → كتير بتفشل صامتاً.
        #   (2) لو الـ strict gates كلها رجعت False → استخدم classify_persona_heuristic
        #       (classifier إرشادي بسيط ما بـ يحتاجش fundamentals — signal + score +
        #       confidence + volume_ratio + optional holding_days). ده الـ single
        #       source of truth اللي بـ يستخدمها backfill_persona_classification.py
        #       كمان، فالتصنيف الجديد + التاريخي بـ يتطابقوا.
        #
        # النتيجة: التوقعات الجديدة بـ تتوزع على الـ 3 شخصيات حتى لو stocks.db
        # ناقصة fundamentals. شاشة المتابعة هـ تظهر مضارب/متوازن/مستثمر بدل
        # "3000 متوازن / 0 الباقي".
        _explicit_persona = bool(options.get('persona_type'))
        if not _explicit_persona:
            try:
                from core.opportunity_quality import (
                    is_gambler_opportunity, is_investor_opportunity,
                    is_balanced_opportunity, classify_persona_heuristic,
                )
                _rec_cls = {
                    'ticker': ticker,
                    'recommendation': recommendation,
                    'signal': recommendation,  # classify_persona_heuristic بـ يقرأ signal
                    'maestro_score': maestro_score,
                    'risk_reward': risk_reward,
                    'confidence': confidence,
                    'entry_price': entry_price,
                }
                _fund_cls = stock or {}
                _stored_cls = {
                    'volume_ratio': float(volume_ratio or 0.0),
                    'current_price': current_price,
                    'updated_at': datetime.now().isoformat(),
                }
                # المرحلة 1: strict gates (بتـ تعتمد على fundamentals)
                if is_gambler_opportunity(_rec_cls, _fund_cls, _stored_cls):
                    persona_type = 'gambler'
                elif is_investor_opportunity(_rec_cls, _fund_cls, _stored_cls):
                    persona_type = 'conservative'
                elif is_balanced_opportunity(_rec_cls, _fund_cls, _stored_cls):
                    persona_type = 'balanced'
                else:
                    # المرحلة 2: heuristic fallback (ما بـ يحتاجش fundamentals).
                    # ده بـ يـ distribute التوقعات على الـ 3 شخصيات بناءً على
                    # signal + score + confidence + volume_ratio. بدون ده، كل
                    # الـ rows اللي strict gates فشلت بـ تروح 'balanced' →
                    # شاشة المتابعة بـ تظهر "3000 متوازن / 0 الباقي".
                    persona_type = classify_persona_heuristic(_rec_cls, _fund_cls, _stored_cls)
                _g_flag = 1 if persona_type == 'gambler' else 0
                _i_flag = 1 if persona_type == 'conservative' else 0
                print(f"[PERSONA_AUTO] ticker={ticker} → {persona_type} (flags g={_g_flag} i={_i_flag}) [orchestrator]")

                # 🔥 P0-v6 FIX #5 (SECTOR-VETO-BEFORE-RECORD):
                #    المالك اشتكى إن المضارب بيدخل في أسهم ميتة. الـ sector veto
                #    قبل كده كان بيـ modify stored_analyses (UI) بس، مش predictions.
                #    دلوقتي بنطبّقه قبل record_prediction: لو laggard في قطاع ميت
                #    → persona=gambler لازم يـ downgrade لـ balanced (ارفض الميت).
                #    ده بـ يـ propagate للـ predictions.persona column فعلياً.
                _cl7_status_v = (options.get('sector_status') or 'neutral').lower()
                _cl7_role_v = (options.get('sector_role') or 'mid').lower()
                if (_cl7_status_v == 'dead' and _cl7_role_v == 'laggard'
                        and persona_type == 'gambler'):
                    persona_type = 'balanced'
                    print(f"[SECTOR_VETO] ticker={ticker} persona gambler→balanced "
                          f"(laggard in dead sector) [orchestrator]", flush=True)
            except Exception as _cls_err:
                # fallback أخير: ابقَ balanced (السلوك القديم) — مش نكسر التحليل
                persona_type = 'balanced'
                print(f"[PERSONA_AUTO] ticker={ticker} → balanced (cls error: {_cls_err}) [orchestrator]", flush=True)

        signal_id = None
        if self.prediction_tracker and recommendation in ['buy', 'strong_buy', 'sell', 'strong_sell']:
            try:
                # ── D2 (Effective Learning): طبّق تأثير الدروس على وقف الخسارة ──
                # لو فيه درس STOP_TOO_TIGHT متكرر → وسّع الوقف بنسبة ATR مسقوفة.
                # ده بـ يغيّر الـ RR فعلياً (مش نفخ ثقة). السقف:
                #   - max 0.5 ATR من التوسيع
                #   - max +50% من المخاطرة الأصلية (ممنوع اتساع بلا حدود)
                #   - max 15% من entry (floor/ceiling مطلق)
                # الـ log: [LEARNING] applied_lesson: ... stop old->new RR old->new
                if expert_memory.stop_widen_atr > 0 and _atr_val > 0 and entry_price > 0:
                    _is_buy_dir = recommendation in ['buy', 'strong_buy']
                    _old_stop = stop_loss
                    _old_rr = risk_reward
                    _widen_amt = expert_memory.stop_widen_atr * _atr_val
                    if _is_buy_dir:
                        _max_widen = (entry_price - stop_loss) * 0.5  # max +50% of original risk
                        _widen_amt = min(_widen_amt, _max_widen)
                        _floor = entry_price * 0.85  # لا تتجاوز 15% تحت entry
                        stop_loss = round2(max(_floor, stop_loss - _widen_amt))
                    else:  # SELL: وقف فوق entry، التوسيع = رفع الوقف
                        _max_widen = (stop_loss - entry_price) * 0.5
                        _widen_amt = min(_widen_amt, _max_widen)
                        _ceiling = entry_price * 1.15  # لا تتجاوز 15% فوق entry
                        stop_loss = round2(min(_ceiling, stop_loss + _widen_amt))
                    # إعادة حساب RR بعد التوسيع
                    if entry_price != stop_loss:
                        risk_reward = round2(abs(target - entry_price) / abs(entry_price - stop_loss))
                    _applied_msg = (
                        f"[LEARNING] applied_lesson: {expert_memory.applied_lesson} "
                        f"dir={'BUY' if _is_buy_dir else 'SELL'} "
                        f"stop {_old_stop}->{stop_loss} RR {_old_rr}->{risk_reward} "
                        f"(atr={_atr_val:.3f} widen_atr={expert_memory.stop_widen_atr})"
                    )
                    logger.info(_applied_msg)
                    print(_applied_msg, flush=True)
                    warnings.append(f'applied_lesson: {expert_memory.applied_lesson}')
                    warnings_ar.append(f'درس مطبّق: {expert_memory.applied_lesson}')

                # ── 🔥 VERIFY-RL: Apply positive-reinforcement adjustments ────
                # (1) target_raise_r: لو الشخصية عندها EARLY_BREAKOUT متكرر →
                #     ارفع الـ target بمقدار target_raise_r × risk_distance.
                # (2) exit_policy='multi_target': لو الـ persona عندها win-side
                #     bias (target_raise أو holdthrough) → علّم التوقع بـ
                #     exit_policy='multi_target' عشان الـ daily_closer يـ route
                #     للـ MultiTargetExitManager بدل الـ dynamic_exit الافتراضي.
                # (_rl_exit_policy تمت تهيئته لـ 'fixed' في الـ outer scope)
                if expert_memory.target_raise_r > 0 and entry_price > 0 and stop_loss > 0:
                    _rl_risk_dist = abs(entry_price - stop_loss)
                    if _rl_risk_dist > 0:
                        _rl_raise_amt = expert_memory.target_raise_r * _rl_risk_dist
                        _old_target = target
                        if recommendation in ['buy', 'strong_buy']:
                            target = round2(target + _rl_raise_amt)
                        else:  # SELL
                            target = round2(target - _rl_raise_amt)
                        _applied_msg2 = (
                            f"[LEARNING-RL] raise_target +{expert_memory.target_raise_r:.2f}R "
                            f"({_rl_raise_amt:.3f} EGP) → target {_old_target}->{target} "
                            f"(persona={persona_type} EARLY_BREAKOUT bias)"
                        )
                        logger.info(_applied_msg2)
                        print(_applied_msg2, flush=True)
                        warnings.append(f'rl_target_raise: +{expert_memory.target_raise_r:.2f}R')
                        warnings_ar.append(f'رفع الهدف من تعلم الصفقات الجيدة: +{expert_memory.target_raise_r:.2f}R')
                        _rl_exit_policy = 'multi_target'
                if expert_memory.t1_holdthrough_bias >= 1.0:
                    _rl_exit_policy = 'multi_target'
                    _ht_msg = (
                        f"[LEARNING-RL] T1_holdthrough=ON (persona={persona_type} "
                        f"TREND_RIDE bias) → exit_policy=multi_target"
                    )
                    logger.info(_ht_msg)
                    print(_ht_msg, flush=True)
                    warnings.append('rl_t1_holdthrough: ON')
                    warnings_ar.append('تعزيز التعلم: احتفاظ بالصفقة عند الهدف الأول لاستغلال الترند')

                # ── PRIORITY-1 / PHASE-1A/1B/1C: Guards قبل record_prediction ──
                # ترتيب الـ guards (كل واحد بـ يشتغل على ناتج اللي قبله):
                #   0) Geometry Guard (UNIFIED-LOGIC 2026-08-30) — HARD REJECT لو target≤entry*1.05
                #      أو stop≥entry*0.95 أو R/R<1.5 (منع التوقعات المعكوسة قبل الكتابة)
                #   1) ATR-based stop  (Priority 1) — استبدل الـ fixed-% P26 stop بـ ATR stop
                #   2) direction guard (1ب) — منع target ≤ entry (بيـ validate الـ ATR stop الجديد)
                #   3) R:R enforcement (1ج) — وسّع الـ target لـ R:R ≥ 1.5 (نسبًا للـ ATR stop)
                #   4) Stock Alive     (1أ) — LOG ONLY (ENFORCE=False)
                try:
                    from core.opportunity_quality import (
                        validate_target_stop_direction,
                        enforce_min_rr,
                        evaluate_stock_alive,
                        enforce_atr_based_stop,
                        STOCK_ALIVE_ENFORCE,
                    )
                    _sig_upper = recommendation.upper()

                    # =====================================================================
                    # UNIFIED-LOGIC (2026-08-30): Geometry Guard (HARD REJECT)
                    # المنطق الموحد: "R/R ≥ 1.5 إجباري (يفضل 1.8+)" + منع التوقعات المعكوسة.
                    # لو أي قاعدة من R1-R5 فشلت → ارفض التوقع قبل الكتابة.
                    # التفاصيل في analyzers/prediction_tracker.py:enforce_geometry_guard.
                    # =====================================================================
                    try:
                        from analyzers.prediction_tracker import enforce_geometry_guard
                        _geom_check = enforce_geometry_guard(_sig_upper, entry_price, target, stop_loss)
                        if _geom_check is None:
                            print(f"[GEOMETRY-REJECT] ticker={ticker} HARD REJECT — "
                                  f"entry={entry_price} target={target} stop={stop_loss} "
                                  f"signal={_sig_upper}", flush=True)
                            warnings.append('Geometry guard: HARD REJECT (هندسة معكوسة أو R/R<1.5)')
                            warnings_ar.append('حارس الهندسة: رفض قاطع (هندسة الصفقة غير صحيحة)')
                            result.signal_id = None
                            return result
                    except Exception as _geom_err:
                        logger.debug(f"Geometry guard wiring failed for {ticker}: {_geom_err}")

                    # Priority 1: ATR-based stop (يحل محل الـ fixed-% P26 stop)
                    # PRODUCTION-WIRING: بتمرير lows للـ swing low detection
                    _prod_lows = [to_num(p.get('low', p.get('low_price', 0))) for p in price_history[-60:]]
                    _atr_stop_check = enforce_atr_based_stop(
                        _sig_upper, entry_price, stop_loss, _atr_val, persona_type,
                        lows=_prod_lows
                    )
                    if _atr_stop_check['action'] == 'replace_stop' and _atr_stop_check['fixed']:
                        _old_s = stop_loss
                        stop_loss = _atr_stop_check['fixed']['stop_loss']
                        print(f"[ATR_STOP] ticker={ticker} {_atr_stop_check['reason']} → stop {_old_s}->{stop_loss}", flush=True)

                    # ── PRODUCTION-WIRING: Dynamic Target (swing high) ──
                    try:
                        from core.opportunity_quality import compute_dynamic_target
                        _prod_highs = [to_num(p.get('high', p.get('high_price', 0))) for p in price_history[-60:]]
                        _dyn_target = compute_dynamic_target(entry_price, stop_loss, _atr_val, highs=_prod_highs, min_rr=1.8)
                        if _dyn_target['target'] > 0 and _dyn_target['rr'] >= 1.8:
                            _old_t = target
                            target = _dyn_target['target']
                            if _dyn_target.get('target_2', 0) > 0:
                                target_price_2 = _dyn_target['target_2']
                            risk_reward = _dyn_target['rr']
                            print(f"[DYN-TARGET-PROD] ticker={ticker} target {_old_t}->{target} "
                                  f"target_2={_dyn_target.get('target_2', 0):.2f} rr={risk_reward:.2f} "
                                  f"({_dyn_target.get('source', '?')})", flush=True)
                    except Exception as _dt_err:
                        logger.debug(f"Dynamic target failed for {ticker}: {_dt_err}")
                    # 1ب: direction guard (الآن بـ validate الـ ATR stop)
                    _dir_check = validate_target_stop_direction(
                        _sig_upper, entry_price, target, stop_loss
                    )
                    if _dir_check['action'] == 'fix_target' and _dir_check['fixed']:
                        if 'target_price' in _dir_check['fixed']:
                            _old_t = target
                            target = _dir_check['fixed']['target_price']
                            print(f"[RR_DIR_FIX] ticker={ticker} {_dir_check['reason']} → target {_old_t}->{target}", flush=True)
                        if 'stop_loss' in _dir_check['fixed']:
                            _old_s = stop_loss
                            stop_loss = _dir_check['fixed']['stop_loss']
                            print(f"[RR_DIR_FIX] ticker={ticker} {_dir_check['reason']} → stop {_old_s}->{stop_loss}", flush=True)
                    elif _dir_check['action'] == 'reject':
                        print(f"[RR_REJECT] ticker={ticker} {_dir_check['reason']}", flush=True)
                        # ارفض التسجيل (return without recording)
                        result.signal_id = None
                        return result
                    # 1ج: enforce R:R ≥ min_rr
                    # 🔥 P0-v7 TASK #4: min_rr من optimizer_params.json (default 1.5)
                    #    الـ learning loop يقدر يرفعها (أكثر صرامة) أو يخفضها.
                    _p07_min_rr = 1.5
                    if _p07_opt_params:
                        try:
                            _p07_min_rr = float(_p07_opt_params.get('min_rr_ratio', 1.5) or 1.5)
                        except (TypeError, ValueError):
                            _p07_min_rr = 1.5
                    _rr_check = enforce_min_rr(_sig_upper, entry_price, target, stop_loss, min_rr=_p07_min_rr)
                    if _rr_check['action'] == 'widen_target' and _rr_check['fixed']:
                        _old_t = target
                        target = _rr_check['fixed']['target_price']
                        risk_reward = _rr_check['rr']
                        print(f"[RR_PLAN] ticker={ticker} {_rr_check['reason']} (new_rr={risk_reward})", flush=True)
                    elif _rr_check['action'] == 'reject':
                        print(f"[RR_REJECT] ticker={ticker} {_rr_check['reason']}", flush=True)
                        result.signal_id = None
                        return result
                    else:
                        # log ok
                        print(f"[RR_PLAN] ticker={ticker} rr={_rr_check['rr']} {_rr_check['reason']}", flush=True)
                    # 1أ-v2: Stock Alive Filter (Rule 8: ATR≥median + chg5d≤p40)
                    # للـ gambler بس — لو ميت، نزل persona لـ balanced (لو ENFORCE=True)
                    if persona_type == 'gambler':
                        # احسب change_5d من price_history (close[-1] / close[-6] - 1) * 100
                        _chg5d = 0.0
                        try:
                            _ph_closes = [c.get('close_price') or c.get('close') for c in (price_history or [])
                                          if (c.get('close_price') or c.get('close')) and (c.get('close_price') or c.get('close')) > 0]
                            if len(_ph_closes) >= 6:
                                _chg5d = (_ph_closes[-1] / _ph_closes[-6] - 1) * 100
                        except Exception:
                            pass
                        # amend the stock dict with change_5d for evaluate_stock_alive
                        _alive_fund = dict(stock or {})
                        _alive_fund['change_5d'] = _chg5d
                        _alive = evaluate_stock_alive(_alive_fund, {
                            'volume_ratio': float(volume_ratio or 0.0),
                            'avg_atr_pct': (_atr_val / entry_price * 100) if (entry_price and _atr_val) else 0,
                            'change_5d': _chg5d,
                        })
                        if not _alive['alive']:
                            if STOCK_ALIVE_ENFORCE:
                                print(f"[STOCK_ALIVE] ticker={ticker} persona=gambler REJECT {_alive['reason']} → downgrade to balanced (enforce=True)", flush=True)
                                persona_type = 'balanced'
                            else:
                                print(f"[STOCK_ALIVE] ticker={ticker} persona=gambler REJECT {_alive['reason']} metrics={_alive['metrics']} (enforce=False → LOG ONLY, no downgrade)", flush=True)
                        else:
                            print(f"[STOCK_ALIVE] ticker={ticker} persona=gambler {_alive['reason']} metrics={_alive['metrics']}", flush=True)
                except Exception as _guard_err:
                    # 🔥 VERIFY-FIX-4: قبل كده كان الـ except بـ log بس ويكمل
                    # record_prediction بالـ values الغير guarded. ده معناه إن
                    # أي exception في الـ guards بـ يـ bypassها → صفقات بـ R/R
                    # أقل من 1.5 بتـ تتسجل. دلوقتي بنـ treat الـ guard exception
                    # كـ reject: نـ skip التسجيل لأننا مش نقدر نثق في الـ values.
                    print(f"[RR_GUARD_ERR] ticker={ticker} {_guard_err} → SKIP recording (cannot trust unguarded values)", flush=True)
                    result.signal_id = None
                    return result

                # =====================================================================
                # 🔥 P0-v11-PROD-PORT (CLOSED-LOOP): max_stop_pct + min_target_pct
                # من optimizer_params.json. الـ learning loop يقدر يحدّ سقف الوقف
                # (مثلاً max 8%) وأرضية الهدف (مثلاً min 4%) عشان يمنع الوقف
                # الواسع جداً والهدف التافه.
                #
                # *** P0-v11 PORT: min_target_pct بقا CONDITIONAL ***
                # - momentum trades (is_momentum=True): min_target_pct=10% (القيمة
                #   الكاملة من optimizer_params — الأسهم الانفجارية لازم هدف طموح).
                # - non-momentum trades: min_target_pct_non_momentum=3% (مرن جداً
                #   عشان الأسهم الهادئة تـ hit target في 20-30 يوم بدل ما تـ timeout
                #   at loss — ده اللي كان بـ cause الـ adaptive_atr bleed).
                # - explosive_uncap path (momentum + vol_pct>80): شيل الـ target cap
                #   تماماً (target=5×ATR) + stop واسع 15% (الأسهم الانفجارية بتنزل
                #   -20% قبل +1000%). ده بـ let it run بدل ما يـ exit بدري.
                # =====================================================================
                if _p07_opt_params and entry_price > 0:
                    try:
                        _p07_max_stop = float(_p07_opt_params.get('max_stop_pct', 8.0) or 8.0)
                        _is_buy_dir = recommendation.upper() in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')

                        # P0-v11 PORT: اقرأ volatility_percentile_90d للكشف عن الأسهم الانفجارية
                        # من الـ DNA profile (_verdict_profile). ده نفس الـ field اللي
                        # الـ backtest بـ يستخدمه للكشف عن vol_pct > 80.
                        _p07_vol_pct = 0.0
                        try:
                            if _verdict_profile and isinstance(_verdict_profile, dict):
                                _p07_vol_pct = float(_verdict_profile.get('volatility_percentile_90d') or 0)
                        except (TypeError, ValueError):
                            _p07_vol_pct = 0.0

                        # P0-v11 PORT: is_momentum من الـ dynamic target block (محسوب فوق)
                        # _mom_is_momentum بـ يكون True لو: volume_ratio>=1.8+change>=3% OR
                        # breakout OR explosive history. ده نفس الـ logic اللي في الـ backtest.
                        _p07_is_mom = bool(_mom_is_momentum)

                        # P0-v11 PORT: explosive_uncap path — momentum + vol>80
                        _p07_is_explosive = _p07_is_mom and _p07_vol_pct > 80

                        if _is_buy_dir:
                            if _p07_is_explosive:
                                # ── EXPLOSIVE_UNCAP: شيل الـ target cap + stop واسع ──
                                # الأسهم الانفجارية بتعمل +50%/+100%/+1000% → target
                                # لازم يكون بعيد جداً (5×ATR) عشان ما نـ exitش بدري.
                                # الـ stop بقا 15% (مش 7%) لأنها بتنزل -20% قبل ما تطير.
                                _p07_explosive_max_stop = float(
                                    _p07_opt_params.get('max_stop_pct_explosive', 15.0) or 15.0
                                )
                                _old_s = stop_loss
                                stop_loss = round2(entry_price * (1 - _p07_explosive_max_stop / 100))
                                # target = 5×ATR (بعيد جداً) — let it run
                                if _atr_val and _atr_val > 0:
                                    _old_t = target
                                    target = round2(entry_price + _atr_val * 5.0)
                                    print(f"[EXPLOSIVE_UNCAP] ticker={ticker} target {_old_t}->{target} "
                                          f"(5×ATR={_atr_val*5.0:.2f}, vol_pct={_p07_vol_pct:.0f}, "
                                          f"stop {_old_s}->{stop_loss} @ {_p07_explosive_max_stop}%)", flush=True)
                                else:
                                    # fallback: target = +30% if no ATR
                                    _old_t = target
                                    target = round2(entry_price * 1.30)
                                    print(f"[EXPLOSIVE_UNCAP] ticker={ticker} target {_old_t}->{target} "
                                          f"(+30% fallback, vol_pct={_p07_vol_pct:.0f}, "
                                          f"stop {_old_s}->{stop_loss} @ {_p07_explosive_max_stop}%)", flush=True)
                                warnings.append(f'EXPLOSIVE_UNCAP: سهم انفجاري (vol={_p07_vol_pct:.0f}%) — هدف مفتوح + وقف واسع')
                                warnings_ar.append(f'سهم انفجاري — الهدف مفتوح للاستفادة من الصعود الكبير (وقف متسع {_p07_explosive_max_stop:.0f}%)')
                            else:
                                # ── NORMAL PATH: max_stop + conditional min_target ──
                                # ceiling على وقف الخسارة: لو الوقف أبعد من max_stop% → قرّبه
                                _stop_dist_pct = abs(entry_price - stop_loss) / entry_price * 100
                                if _stop_dist_pct > _p07_max_stop:
                                    _old_s = stop_loss
                                    stop_loss = round2(entry_price * (1 - _p07_max_stop / 100))
                                    print(f"[OPT_PARAMS] ticker={ticker} stop capped: "
                                          f"{_old_s}->{stop_loss} (max_stop_pct={_p07_max_stop}%)", flush=True)

                                # floor على الهدف — CONDITIONAL (P0-v11 PORT):
                                # momentum → 10% (طموح), non-momentum → 3% (مرن)
                                if _p07_is_mom:
                                    _p07_min_target = float(_p07_opt_params.get('min_target_pct', 10.0) or 10.0)
                                    _p07_target_label = 'momentum'
                                else:
                                    _p07_min_target = float(
                                        _p07_opt_params.get('min_target_pct_non_momentum', 3.0) or 3.0
                                    )
                                    _p07_target_label = 'non-momentum'
                                _tgt_pct = (target - entry_price) / entry_price * 100
                                if _tgt_pct < _p07_min_target:
                                    _old_t = target
                                    target = round2(entry_price * (1 + _p07_min_target / 100))
                                    print(f"[OPT_PARAMS] ticker={ticker} target floored: "
                                          f"{_old_t}->{target} (min_target_pct={_p07_min_target}% [{_p07_target_label}])", flush=True)
                    except Exception as _opt_e:
                        print(f"[OPT_PARAMS] ticker={ticker} apply failed: {_opt_e}", flush=True)

                # =====================================================================
                # 🔥 VERIFY-FIX-4: POST-OVERRIDE R/R RE-VALIDATION
                # الـ EXPLOSIVE_UNCAP (و OPT_PARAMS) بـ يـ override الـ stop/target
                # AFTER ما الـ guards الأصلية شغلت. ده معناه إن الـ R/R اللي الـ
                # guards ضامنته ممكن يـ break تاني:
                #   - EXPLOSIVE_UNCAP: stop=15%, target=5×ATR. لو ATR/price=2%
                #     → target=+10%, stop=-15% → R/R = 10/15 = 0.67 (تحت 1.5!)
                # الحل: نـ re-run enforce_min_rr + validate_target_stop_direction
                # على الـ values النهائية. لو الـ R/R لسه < 1.5 → وسّع الـ target.
                # لو مش ممكن نصلحه (reject) → skip التسجيل.
                # =====================================================================
                try:
                    from core.opportunity_quality import (
                        enforce_min_rr,
                        validate_target_stop_direction,
                    )
                    _sig_final = recommendation.upper()
                    _final_min_rr = 1.5
                    if _p07_opt_params:
                        try:
                            _final_min_rr = float(_p07_opt_params.get('min_rr_ratio', 1.5) or 1.5)
                        except (TypeError, ValueError):
                            _final_min_rr = 1.5

                    # Direction re-check on final values
                    _final_dir = validate_target_stop_direction(_sig_final, entry_price, target, stop_loss)
                    if _final_dir['action'] == 'reject':
                        print(f"[RR_POST_REJECT] ticker={ticker} post-override direction check FAILED: {_final_dir['reason']} → SKIP recording", flush=True)
                        result.signal_id = None
                        return result
                    elif _final_dir['action'] == 'fix_target' and _final_dir['fixed']:
                        if 'target_price' in _final_dir['fixed']:
                            _old_t = target
                            target = _final_dir['fixed']['target_price']
                            print(f"[RR_POST_DIR] ticker={ticker} target {_old_t}->{target} ({_final_dir['reason']})", flush=True)
                        if 'stop_loss' in _final_dir['fixed']:
                            _old_s = stop_loss
                            stop_loss = _final_dir['fixed']['stop_loss']
                            print(f"[RR_POST_DIR] ticker={ticker} stop {_old_s}->{stop_loss} ({_final_dir['reason']})", flush=True)

                    # R/R re-check on final values
                    _final_rr = enforce_min_rr(_sig_final, entry_price, target, stop_loss, min_rr=_final_min_rr)
                    if _final_rr['action'] == 'widen_target' and _final_rr['fixed']:
                        _old_t = target
                        target = _final_rr['fixed']['target_price']
                        risk_reward = _final_rr['rr']
                        print(f"[RR_POST_PLAN] ticker={ticker} post-override target {_old_t}->{target} (rr={risk_reward}, {_final_rr['reason']})", flush=True)
                    elif _final_rr['action'] == 'reject':
                        print(f"[RR_POST_REJECT] ticker={ticker} post-override R/R check FAILED: {_final_rr['reason']} → SKIP recording", flush=True)
                        result.signal_id = None
                        return result
                except Exception as _post_guard_err:
                    # لو الـ re-validation نفسها فشلت → مش نأمن نـ record بقيم ممكن
                    # تكون خطيرة. نـ skip.
                    print(f"[RR_POST_ERR] ticker={ticker} post-override validation error: {_post_guard_err} → SKIP recording", flush=True)
                    result.signal_id = None
                    return result

                # أعد حساب risk_reward بعد كل الـ guards (ATR stop + direction + R:R)
                # علشان الـ value اللي بيتسجل في الـ result/analysis_json يكون مطابق
                # للـ target/stop النهائي (مش الـ P26 القديم).
                try:
                    if entry_price != stop_loss and entry_price > 0 and stop_loss > 0:
                        risk_reward = round2((target - entry_price) / (entry_price - stop_loss))
                except Exception:
                    pass

                # RL-FIX-18: T1/T2 multi-target + explosive flag
                # المالك: "هدف أول وثانى عالشان لو السهم ناوى يطير ميضعش من أدينا"
                # + "ركز على الأسهم الانفجارية اللي كل يوم بتظهر بكم رهيب من الأرباح"
                #
                # لو السهم انفجاري (EXPLOSIVE_UNCAP fired) → T1 = current target (5×ATR),
                #   T2 = T1 × 1.6 (let it run for max profit)
                # لو السهم عادي + ATR معروف → T1 = current target, T2 = T1 + 2×ATR
                # لو مش ممكن نحسب T2 → T2 = 0 (يتعامل معاه كـ single-target)
                _rl_t2 = 0.0
                _rl_expl_score = 0.0
                _rl_expl_label = ''
                try:
                    if _is_buy_dir and target and entry_price and target > entry_price:
                        # حدد إن كان السهم انفجاريًا (من المتغيرات العلوية)
                        _rl_is_explosive = bool(_p07_is_explosive) if '_p07_is_explosive' in dir() else False
                        if _rl_is_explosive:
                            _rl_expl_label = 'BOMB' if (_p07_vol_pct or 0) > 95 else 'ROCKET'
                            _rl_expl_score = min(100.0, 65.0 + (_p07_vol_pct or 0) / 4.0)
                            # T2 = T1 × 1.6 للانفجارية (let it run)
                            _rl_t2 = round2(target * 1.6)
                        elif _atr_val and _atr_val > 0:
                            # سهم عادي: T2 = T1 + 2×ATR
                            _rl_t2 = round2(target + _atr_val * 2.0)
                            # درجة انفجارية بناءً على volume + momentum
                            _rl_vol = (_p07_vol_pct or 0) if '_p07_vol_pct' in dir() else 0
                            if _rl_vol > 80:
                                _rl_expl_label = 'SPARK'
                                _rl_expl_score = 55.0
                except Exception as _rl_t2_err:
                    print(f"[RL-FIX-18] T2/explosive calc failed for {ticker}: {_rl_t2_err}", flush=True)

                # =====================================================================
                # PRODUCTION-WIRING (2026-08-30): Entry Gate + Position Sizing
                # ربط كل تحسينات الباك تست في الإنتاج الحقيقي.
                # 1) Entry Gate: 8 شروط إلزامية قبل تسجيل التوقع.
                # 2) Position Sizing: حساب حجم المركز من مسافة الوقف.
                # =====================================================================
                try:
                    from utils.entry_gate import check_entry_gate
                    _gate_closes = [to_num(p.get('close', p.get('close_price', 0))) for p in price_history[-60:]]
                    _gate_vols = [to_num(p.get('volume', p.get('volume_traded', 0))) for p in price_history[-60:]]
                    _gate_proofs = {}
                    if hasattr(result, 'proofs') and isinstance(result.proofs, dict):
                        _gate_proofs = result.proofs
                    _gate_data = {
                        'entry_price': entry_price,
                        'target_price': target,
                        'stop_price': stop_loss,
                        'evidence_count': sum(1 for v in _gate_proofs.values() if '✅' in str(v)),
                        'proofs': _gate_proofs,
                        'closes': _gate_closes,
                        'volumes': _gate_vols,
                        'market_regime_trend': regime_phase.phase if regime_phase else 'range',
                        'stock_roc': float(stock.get('change_percent', 0) or 0),
                        'benchmark_change': float(options.get('benchmark_change', 0) or 0),
                    }
                    _gate_result = check_entry_gate(_gate_data)
                    if not _gate_result['passed']:
                        _fail = '; '.join(_gate_result['reasons_failed'][:3])
                        print(f"[PROD-ENTRY-GATE-REJECT] {ticker}: score={_gate_result['score']}/{_gate_result['total_checks']} | {_fail}", flush=True)
                        result.signal_id = None
                        return result
                except Exception as _gate_err:
                    logger.debug(f"Entry gate failed for {ticker}: {_gate_err}")

                # Position Sizing
                try:
                    from utils.position_sizing import calculate_risk_based_position
                    _pos_result = calculate_risk_based_position(
                        capital=float(options.get('capital', 100000)),
                        entry_price=entry_price,
                        stop_price=stop_loss,
                        confidence=confidence / 100.0 if confidence > 1 else 0.8,
                    )
                    if _pos_result['action'] == 'enter':
                        warnings.append(f"Position size: {_pos_result['position_pct']:.1f}% ({_pos_result['shares']} shares)")
                        warnings_ar.append(f"حجم المركز: {_pos_result['position_pct']:.1f}% ({_pos_result['shares']} سهم)")
                except Exception as _pos_err:
                    logger.debug(f"Position sizing failed for {ticker}: {_pos_err}")

                signal_id = self.prediction_tracker.record_prediction(
                    ticker=ticker,
                    signal=recommendation.upper(),
                    entry_price=entry_price,
                    target_price=target,
                    stop_loss=stop_loss,
                    master_score=maestro_score,
                    technical_score=quality_score,
                    fundamental_score=quality_score,
                    notes=f"Confidence: {confidence}%",
                    persona=persona_type,
                    atr_at_entry=_atr_val,
                    target_price_2=_rl_t2,
                    explosive_score=_rl_expl_score,
                    explosive_label=_rl_expl_label,
                )
                if _rl_t2 > 0:
                    print(
                        f"[RL-FIX-18] ticker={ticker} T1={target:.2f} T2={_rl_t2:.2f} "
                        f"expl={_rl_expl_label or '-'}/{_rl_expl_score:.0f}",
                        flush=True,
                    )
                # 🔥 VERIFY-RL: لو الـ persona عندها win-side bias → علّم التوقع
                # بـ exit_policy='multi_target' عشان الـ daily_closer يـ route
                # للـ MultiTargetExitManager (T1/T2/T3 + dynamic stop + hold-through).
                # الـ column exit_policy موجود في الـ schema بس ما كانش بـ يتكتب أبداً.
                if signal_id and (_rl_exit_policy == 'multi_target' or _rl_t2 > 0):
                    try:
                        import sqlite3 as _rl_sql
                        _rl_db = self.prediction_tracker.db_path
                        _rl_conn = _rl_sql.connect(_rl_db, timeout=10.0)
                        # RL-FIX-18: set exit_policy=multi_target لو T2 موجود
                        _rl_policy = 'multi_target' if _rl_t2 > 0 else _rl_exit_policy
                        _rl_conn.execute(
                            'UPDATE predictions SET exit_policy = ? WHERE id = ?',
                            (_rl_policy, signal_id)
                        )
                        _rl_conn.commit()
                        _rl_conn.close()
                    except Exception as _rl_upd_err:
                        logger.warning(f"[Maestro] Failed to set exit_policy=multi_target for #{signal_id}: {_rl_upd_err}")
            except Exception as e:
                print(f"[Maestro] Failed to track prediction: {e}")

        result.signal_id = signal_id
        return result


# ==================== CONVENIENCE FUNCTIONS ====================

def run_maestro_analysis(ticker: str, stock: Dict, price_history: List[Dict], db_path: str, options: Dict = None) -> Dict:
    orchestrator = MaestroOrchestrator(db_path)
    result = orchestrator.analyze(ticker, stock, price_history, options)
    analysis_json = None
    # Unified Persona Engine: priority for new structure (gambler + investor + narrative + context)
    if result.gambler or result.investor or result.persona_narrative:
        analysis_json = {
            'narrative': result.persona_narrative or {},
            'gambler': result.gambler or {},
            'investor': result.investor or {},
            # P26-PERSONA-SEPARATION: R/R الخاص بكل persona للواجهة.
            'persona_rr': result.persona_rr or {},
            'context': {
                'time': result.human_context.time_context if result.human_context else {},
                'sector': result.human_context.sector_context if result.human_context else {},
                'market': result.human_context.market_context if result.human_context else {},
                'historical': result.human_context.historical_context if result.human_context else {},
                'behavioral': result.human_context.behavioral_context if result.human_context else {},
            },
        }
    elif result.human_narrative or result.human_personas or result.human_context:
        # Fallback: الـ personas القديمة (hunter/momentum/value)
        analysis_json = {
            'narrative': {'line1': result.human_narrative.line1, 'line2': result.human_narrative.line2, 'line3': result.human_narrative.line3} if result.human_narrative else {},
            'personas': {'hunter': result.human_personas.hunter, 'momentum': result.human_personas.momentum, 'value': result.human_personas.value} if result.human_personas else {},
            'context': {'time': result.human_context.time_context, 'sector': result.human_context.sector_context, 'market': result.human_context.market_context, 'historical': result.human_context.historical_context, 'behavioral': result.human_context.behavioral_context} if result.human_context else {},
        }
    return {
        'ticker': result.ticker, 'timestamp': result.timestamp, 'maestro_score': result.maestro_score,
        'recommendation': result.recommendation, 'recommendation_ar': result.recommendation_ar,
        'confidence': result.confidence, 'entry_price': result.entry_price, 'stop_loss': result.stop_loss, 'target': result.target, 'risk_reward': result.risk_reward,
        'phases': result.phases,
        'persona': {'type': result.persona.persona_type, 'adjusted_score': result.persona.adjusted_score, 'position_size_percent': result.persona.position_size_percent, 'notes': result.persona.notes} if result.persona else None,
        'warnings': result.warnings, 'warnings_ar': result.warnings_ar,
        'human_narrative': {'line1': result.human_narrative.line1, 'line2': result.human_narrative.line2, 'line3': result.human_narrative.line3} if result.human_narrative else None,
        'human_personas': {'hunter': result.human_personas.hunter, 'momentum': result.human_personas.momentum, 'value': result.human_personas.value} if result.human_personas else None,
        'human_context': {'time': result.human_context.time_context, 'sector': result.human_context.sector_context, 'market': result.human_context.market_context, 'historical': result.human_context.historical_context, 'behavioral': result.human_context.behavioral_context} if result.human_context else None,
        # Unified Persona Engine (new)
        'gambler': result.gambler,
        'investor': result.investor,
        'persona_narrative': result.persona_narrative,
        # P26-PERSONA-SEPARATION: كل persona ليها target/stop مختلفة.
        'persona_rr': result.persona_rr,
        'analysis_json': analysis_json,
        # POSITION-SIZING-024
        'suggested_position_size_pct': result.suggested_position_size_pct,
        'position_warning': result.position_warning,
    }


def batch_maestro_analysis(stocks: List[Dict], db_path: str, options: Dict = None) -> List[Dict]:
    orchestrator = MaestroOrchestrator(db_path)
    results = []
    for stock_data in stocks:
        ticker = stock_data.get('ticker')
        stock = stock_data.get('stock', {})
        price_history = stock_data.get('price_history', [])
        try:
            result = orchestrator.analyze(ticker, stock, price_history, options)
            results.append({'ticker': result.ticker, 'maestro_score': result.maestro_score, 'recommendation': result.recommendation, 'recommendation_ar': result.recommendation_ar})
        except Exception as e:
            print(f'[Maestro] Error analyzing {ticker}: {e}')
    return sorted(results, key=lambda x: x['maestro_score'], reverse=True)


# ==================== DAILY OPPORTUNITIES ====================

def daily_opportunities(market: str = 'EGX', limit: int = 5) -> Dict:
    from core.database import DatabaseManager
    db_path = STOCKS_DB
    if not os.path.exists(db_path):
        return {'date': datetime.now().strftime('%Y-%m-%d'), 'top_3': [], 'count': 0, 'error': 'db not found'}
    db = DatabaseManager(db_path)
    # Bound the universe to the top 200 active stocks so daily_opportunities
    # doesn't scan every ticker in the DB (most are illiquid / inactive).
    # P0 fix (يوليو 2026): فلترة حسب market — قبل كده كان بيجيب كل الأسهم من كل الأسواق
    # فكان بيبعت أسهم سعودية للقناة المصرية!
    # نجرب فلترة بـ 'EGX' الأول، لو مفيش نتائج نجرب بـ 'مصر' (اسم السوق بالعربي)
    stocks = []
    if hasattr(db, 'get_all_stocks'):
        # جرّب أسماء السوق المختلفة (الـ DB ممكن يستخدم EGX أو مصر)
        for market_name in [market, 'EGX', 'مصر', 'egypt']:
            stocks = db.get_all_stocks(market=market_name, limit=200)
            if stocks:
                break
        # fallback: لو مفيش فلترة اشتغلت، جيب كل الأسهم بس افلترها بعدين
        if not stocks:
            stocks = db.get_all_stocks(limit=200)
            # افلتر الأسهم اللي ticker بتاعها أرقام (سعودي) أو ليها suffixes تانية
            stocks = [s for s in stocks if not s.get('ticker', '').isdigit()]
    if not stocks:
        return {'date': datetime.now().strftime('%Y-%m-%d'), 'top_3': [], 'count': 0, 'error': 'no stocks'}
    orchestrator = MaestroOrchestrator(db_path)
    candidates = []
    for stock in stocks:
        ticker = stock.get('ticker', '')
        if not ticker:
            continue
        try:
            # PHASE 1 (v3.50.0): delegate to data.prices — single source of truth
            from data.prices import load_price_history
            # Original SQL returned DESC (most recent first) + close_price/high_price/... keys.
            # load_price_history returns oldest-first + close/high/... keys.
            # Preserve the original shape: reverse + map keys.
            _hist_raw = load_price_history(ticker, limit=100)
            history = [{
                'date': r.get('date'),
                'open_price': r.get('open'),
                'high_price': r.get('high'),
                'low_price': r.get('low'),
                'close_price': r.get('close'),
                'volume': r.get('volume'),
            } for r in reversed(_hist_raw)]
            if not history:
                continue
            result = orchestrator.analyze(ticker, stock, history, {})
            
            # FILTER: collapse filter — stock dropping >50% in a month is excluded
            tc = result.human_context.time_context if result.human_context else {}
            change_1m = tc.get('change_1m')
            if change_1m is not None and change_1m < -50:
                continue
            
            if not result.human_personas or not result.human_narrative:
                continue
            hp = result.human_personas
            hunter_score = hp.hunter.get('score', 0) if hp.hunter else 0
            momentum_score = hp.momentum.get('score', 0) if hp.momentum else 0
            value_score = hp.value.get('score', 0) if hp.value else 0
            if max(hunter_score, momentum_score, value_score) >= 65:
                candidates.append({
                    'ticker': result.ticker,
                    'name': stock.get('name_ar', '') or stock.get('name', ticker),
                    'price': result.entry_price or 0,
                    'maestro_score': result.maestro_score,
                    'recommendation_ar': result.recommendation_ar,
                    'confidence': result.confidence,
                    'hunter_score': hunter_score, 'momentum_score': momentum_score, 'value_score': value_score,
                    'hunter_verdict': hp.hunter.get('verdict', '') if hp.hunter else '',
                    'momentum_verdict': hp.momentum.get('verdict', '') if hp.momentum else '',
                    'value_verdict': hp.value.get('verdict', '') if hp.value else '',
                    'narrative_line1': result.human_narrative.line1,
                    'narrative_line2': result.human_narrative.line2,
                    'narrative_line3': result.human_narrative.line3,
                    'stop_loss': result.stop_loss, 'target': result.target, 'entry_price': result.entry_price,
                })
        except Exception as e:
            print(f'[DailyOpp] Error analyzing {ticker}: {e}')
            continue
    candidates.sort(key=lambda x: (max(x['hunter_score'], x['momentum_score'], x['value_score']), x['maestro_score']), reverse=True)
    top = candidates[:limit]
    return {'date': datetime.now().strftime('%Y-%m-%d'), 'market': market, 'count': len(top), 'opportunities': top}
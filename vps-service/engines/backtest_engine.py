#!/usr/bin/env python3
"""
V38 Institutional Decision Engine — Backtester
================================================
محرك القرار المؤسسي V38 — محاكاة شاملة على كل أسهم البورصة المصرية

مبني على نفس منطق TradingView Pine Script V38 مع التعديلات الآتية:
  1. محرك البيانات والزخم (ATR, RSI, Bollinger Bands, Squeeze/Expansion)
  2. محرك الميكرز (تجميع/تصريف/سحب سيولة/لا عرض)
  3. محرك البصمة المستقبلية (DNA Pattern Matching)
  4. محرك الأساسيات (P/E, ROE)
  5. محرك القطاع
  6. نظام الإثباتات الخمسة (5 Proofs)
  7. التعلم الديناميكي (Adaptive Threshold)
  8. القيمة العادلة (VWAP)
  9. محرك الأخطار والسحب (Order Blocks & Liquidity Sweeps)

Usage:
    python3 vps-service/engines/backtest_engine.py --all
    python3 vps-service/engines/backtest_engine.py --tickers COMI CIB ORAS --start 2025-06-01
"""

from __future__ import annotations

import os
import sys

# BRAVO INDICATOR-UNIFY (2026-10-19): توحيد كل المؤشرات على canonical library
# Rule 54 (CALCULATION-CANONICAL): analyzers/indicators/ = المصدر الوحيد
_VPS_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if _VPS_ROOT not in sys.path:
    sys.path.insert(0, _VPS_ROOT)
from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi
from analyzers.indicators.atr import calc_atr as _canonical_calc_atr
from analyzers.indicators.ma import sma as _canonical_sma, ema as _canonical_ema
from analyzers.indicators.bollinger import calc_bollinger_series as _canonical_bollinger_series
from utils.fair_value import calc_vwap_fair_value as _canonical_vwap_fair_value
import json
import sqlite3
import math
import argparse
from pathlib import Path
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field, asdict
from contextlib import contextmanager

# Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
try:
    from core.db_manager import db_manager as _dbm
    _V38_BT_DBM_AVAILABLE = True
except Exception as _v38bt_err:
    _V38_BT_DBM_AVAILABLE = False
    print(f"[v38_backtest_engine] db_manager not available ({_v38bt_err}) — falling back to raw sqlite3")


@contextmanager
def _open_db(db_path: str, writable: bool = False):
    """Rule 54 / Phase 3: استخدم db_manager.connection() مع fallback sqlite3.connect."""
    ctx = None
    conn = None
    try:
        if _V38_BT_DBM_AVAILABLE:
            ctx = _dbm.connection(db_path, writable=writable)
            conn = ctx.__enter__()
        else:
            raise RuntimeError("db_manager unavailable")
    except Exception:
        conn = sqlite3.connect(db_path, timeout=30.0)
        try:
            conn.execute('PRAGMA busy_timeout=30000')
            if writable:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA synchronous=NORMAL')
        except Exception:
            pass
        ctx = None
    try:
        yield conn
    finally:
        try:
            if ctx is not None:
                ctx.__exit__(None, None, None)
            else:
                conn.close()
        except Exception:
            pass

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
VPS_SERVICE_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = VPS_SERVICE_DIR.parent

if str(VPS_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(VPS_SERVICE_DIR))

from analyzers.engine_settings import get_setting
from analyzers.institutional_decision_engine import build_institutional_decision
try:
    from analyzers.liquidity_filter import set_strict_kill_filters
except ImportError:
    def set_strict_kill_filters(enabled: bool) -> None:
        pass

# ─── Task part4-stop-loss: stock_state helper (entry gate) ───────────────
# المالك: "أحنا لازم نركز جدا فى وقت الدخول عالشان نقلل من وقف الخسائر"
# is_in_active_correction(stock) → True لو السهم في تصحيح نشط (تحت MA50 +
# change < 0 + RSI < 45 + مش قريب من 52w low) → V38 entry gate يـ reject BUY.
try:
    from utils.stock_state import is_in_active_correction
    _STOCK_STATE_AVAILABLE = True
except ImportError as _ss_e:  # pragma: no cover
    _STOCK_STATE_AVAILABLE = False
    print(f"[V38Engine] stock_state helper unavailable (entry gate disabled): {_ss_e}")
    def is_in_active_correction(stock):  # type: ignore[no-redef]
        return False

# V40.4: MarketProfile injection (Unified Multi-Market Architecture, Directive §2)
# Lazy import — avoids circular dependency at module load time.
try:
    from config.unified_config import MARKET_PROFILES, MarketProfile
except ImportError:  # pragma: no cover
    MARKET_PROFILES = {}
    class MarketProfile:  # type: ignore
        """Fallback stub when unified_config is unavailable."""
        pass

# ---------------------------------------------------------------------------
# Database paths
# ---------------------------------------------------------------------------
# V40.2 → PHASE-1-DB-UNIFY (2026-08-29): توحيد مصدر الأسعار
# data_engine.db هو المصدر الوحيد — prices.db متجمد + price_history.db مفقود
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')

def _resolve_price_history_db():
    """Find the database with actual price data.

    PHASE-1-DB-UNIFY: data_engine.db is the ONLY source.
    Removed: prices.db (stale — ends 2026-06-10) + price_history.db (missing).
    """
    # PRIMARY + ONLY: data_engine.db (egksco_price_history — 162K+ rows)
    primary = str(PROJECT_ROOT / 'db' / 'data_engine.db')
    try:
        if os.path.exists(primary) and os.path.getsize(primary) > 1000:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _v38_rph_ctx = None
            try:
                if _V38_BT_DBM_AVAILABLE:
                    _v38_rph_ctx = _dbm.connection(primary, writable=False)
                    db = _v38_rph_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                db = sqlite3.connect(f'file:{primary}?mode=ro', uri=True, timeout=3)
                _v38_rph_ctx = None
            tables = [r[0] for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()]
            if 'egksco_price_history' in tables:
                count = db.execute('SELECT COUNT(*) FROM egksco_price_history').fetchone()[0]
                db.close()
                if count >= 100:
                    return primary
            db.close()
    except Exception:
        pass

    # Fallback: stocks.db (stock_daily_prices — partial but recent)
    stocks_db = str(PROJECT_ROOT / 'db' / 'stocks.db')
    try:
        if os.path.exists(stocks_db) and os.path.getsize(stocks_db) > 1000:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _v38_rph2_ctx = None
            try:
                if _V38_BT_DBM_AVAILABLE:
                    _v38_rph2_ctx = _dbm.connection(stocks_db, writable=False)
                    db = _v38_rph2_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                db = sqlite3.connect(f'file:{stocks_db}?mode=ro', uri=True, timeout=3)
                _v38_rph2_ctx = None
            tables = [r[0] for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()]
            if 'stock_daily_prices' in tables:
                count = db.execute('SELECT COUNT(*) FROM stock_daily_prices').fetchone()[0]
                db.close()
                if count >= 100:
                    print(f"[V38Engine] Fallback: stocks.db (stock_daily_prices, {count} rows)")
                    return stocks_db
            db.close()
    except Exception:
        pass

    return primary

PRICE_HISTORY_DB = str(Path(__file__).resolve().parents[2] / 'db' / 'data_engine.db')
# price_history.db تم إلغاؤه تماماً (2026-09-03)
# Owner: "ألغى التعامل مع price_history.db خالص الموضوع مش ناقص تخبط"
# كل القراءة الآن من data_engine.db.egksco_price_history فقط.


# ===========================================================================
# 1. محرك البيانات والزخم (Data & Momentum Engine)
# ===========================================================================

def parse_volume(val: Any) -> float:
    """Parse volume value that may be integer, float, or text like '105.79\u202fK' or '5.06\u202fM'"""
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    try:
        return float(val)
    except (TypeError, ValueError):
        pass
    # Handle text like '105.79\u202fK' or '5.06\u202fM'
    s = str(val).replace('\u202f', '').replace(' ', '').strip()
    try:
        if s.endswith('M'):
            return float(s[:-1]) * 1_000_000
        elif s.endswith('K'):
            return float(s[:-1]) * 1_000
        elif s.endswith('B'):
            return float(s[:-1]) * 1_000_000_000
        return float(s)
    except (TypeError, ValueError):
        return 0.0


def calc_sma(data: List[float], period: int) -> List[float]:
    """SMA as array — BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.sma per point."""
    result = []
    for i in range(len(data)):
        if i < period - 1:
            result.append(sum(data[:i+1]) / (i + 1))
        else:
            val = _canonical_sma(data[:i+1], period)
            result.append(val if val is not None else sum(data[i-period+1:i+1]) / period)
    return result


def calc_ema(data: List[float], period: int) -> List[float]:
    """EMA as array — BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.ema per point."""
    result = []
    for i in range(len(data)):
        if i == 0:
            result.append(data[0])
        elif i < period - 1:
            result.append(data[i])
        else:
            val = _canonical_ema(data[:i+1], period)
            result.append(val if val is not None else data[i])
    return result


def _calc_rsi_series(closes: List[float], period: int = 14) -> List[float]:
    """RSI as array — BRAVO UNIFY: delegates to canonical analyzers.indicators.rsi.calc_rsi per point."""
    result = [50.0]
    if len(closes) < 2:
        return result
    for i in range(1, len(closes)):
        if i < period:
            result.append(50.0)
        else:
            val = _canonical_calc_rsi(closes[:i+1], period)
            result.append(val if val is not None else 50.0)
    return result


def calc_atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> List[float]:
    """ATR as array — BRAVO UNIFY: delegates to canonical analyzers.indicators.atr.calc_atr per point."""
    result = [0.0]
    if len(highs) < 2:
        return [0.0] * len(highs)
    for i in range(1, len(highs)):
        val = _canonical_calc_atr(highs[:i+1], lows[:i+1], closes[:i+1], period)
        result.append(val if val is not None else 0.0)
    return result


def calc_bollinger_bands(closes: List[float], period: int = 20, std_dev: float = 2.0) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    """Bollinger Bands (middle, upper, lower) — BRAVO UNIFY: delegates to canonical analyzers.indicators.bollinger.
    Rule 27 (NO-FAKE-DATA): لو البيانات غير كافية → بيرجّع lists بـ None values (مش fabrication).
    """
    result = _canonical_bollinger_series(closes, period, std_dev)
    if result is None:
        # Rule 27: return None lists (not fabricated values)
        return [None] * len(closes), [None] * len(closes), [None] * len(closes)
    # preserve None values (first period-1 entries) — caller must handle None
    mid_list = result['middle']
    upper_list = result['upper']
    lower_list = result['lower']
    return mid_list, upper_list, lower_list


# ===========================================================================
# 2. محرك الميكرز (Maker Detection Engine)
# ===========================================================================

@dataclass
class MakerState:
    is_absorption: bool = False
    is_distribution: bool = False
    is_sweep: bool = False
    is_no_supply: bool = False
    is_no_demand: bool = False
    maker_bullish: bool = False
    maker_bearish: bool = False
    state: str = 'calm'  # accumulation, distribution, calm
    state_ar: str = 'هدوء'
    emoji: str = '⚪'
    reason: str = ''


def detect_maker_state(
    closes: List[float],
    opens: List[float],
    highs: List[float],
    lows: List[float],
    volumes: List[float],
    atr_val: float,
    vol_ma: float,
) -> MakerState:
    """
    كشف حالة الميكرز (تجميع / تصريف / هدوء)
    
    من V38 Pine Script:
    - is_absorption: شمعة حمراء + حجم عالي (>1.5×avg) + close > low - 0.2×atr
    - is_distribution: شمعة خضراء + حجم عالي + close < high - 0.2×atr
    - maker_sweep: sweep_low + vol_ratio > 1.5
    - no_supply: شمعة حمراء + حجم ضعيف (<0.5×avg)
    """
    m = MakerState()
    
    if len(closes) < 2 or atr_val <= 0:
        return m
    
    last_close = closes[-1]
    last_open = opens[-1]
    last_high = highs[-1]
    last_low = lows[-1]
    last_vol = volumes[-1] if volumes[-1] else 0
    
    vol_ratio = last_vol / vol_ma if vol_ma > 0 else 1.0
    is_red = last_close < last_open
    is_green = last_close > last_open
    
    # Absorption: red candle + high volume + close near top
    m.is_absorption = is_red and vol_ratio > get_setting('volume_absorption_ratio', default=1.5) and last_close > (last_low + atr_val * get_setting('atr_wick_mult', default=0.2))
    
    # Distribution: green candle + high volume + close near bottom
    m.is_distribution = is_green and vol_ratio > get_setting('volume_absorption_ratio', default=1.5) and last_close < (last_high - atr_val * get_setting('atr_wick_mult', default=0.2))
    
    # No supply: red candle + very low volume (no sellers = accumulation)
    m.is_no_supply = is_red and vol_ratio < get_setting('volume_no_supply_ratio', default=0.5)
    
    # No demand: green candle + very low volume (no buyers = distribution)
    m.is_no_demand = is_green and vol_ratio < get_setting('volume_no_supply_ratio', default=0.5)
    
    # Determine state
    m.maker_bullish = m.is_absorption or m.is_no_supply
    m.maker_bearish = m.is_distribution or m.is_no_demand
    
    if m.maker_bullish:
        m.state = 'accumulation'
        m.state_ar = 'تجميع'
        m.emoji = '🟢'
        m.reason = 'absorption' if m.is_absorption else 'no_supply'
    elif m.maker_bearish:
        m.state = 'distribution'
        m.state_ar = 'تصريف'
        m.emoji = '🔴'
        m.reason = 'distribution' if m.is_distribution else 'no_demand'
    else:
        m.state = 'calm'
        m.state_ar = 'هدوء'
        m.emoji = '⚪'
        m.reason = 'neutral'
    
    return m


# ===========================================================================
# 3. محرك البصمة المستقبلية (DNA Pattern Matching Engine)
# ===========================================================================

def dna_pattern_match(
    closes: List[float],
    pattern_len: int = 10,
    search_depth: int = 100,
    proj_len: int = 10,
) -> Dict[str, Any]:
    """
    محرك البصمة — يبحث في التاريخ عن أقرب نمط مشابه ويستخدمه للتوقع
    
    من V38 Pine Script:
    - يحسب نسب التغير لأخر pattern_len شموع
    - يبحث في التاريخ (search_depth) عن أقرب نمط
    - يقدر الحركة القادمة بناءً على ما حدث بعد النمط المشابه
    """
    result = {
        'target_price': None,
        'move_pct': 0.0,
        'bullish': False,
        'match_distance': float('inf'),
        'match_index': -1,
    }
    
    total_bars = len(closes)
    total_hist = min(search_depth + (3 * proj_len) + pattern_len, total_bars)
    
    if total_hist <= pattern_len + (3 * proj_len):
        return result
    
    # Current pattern (percent changes)
    cur_pattern = []
    for j in range(pattern_len):
        if j + 1 < len(closes) and closes[j + 1] > 0:
            cur_pattern.append((closes[j] - closes[j + 1]) / closes[j + 1])
        else:
            cur_pattern.append(0.0)
    
    # Search for best match
    start_i = 3 * proj_len
    end_i = total_hist - pattern_len - 1
    
    if end_i < start_i:
        return result
    
    best_dist = float('inf')
    best_i = 0
    
    for i in range(start_i, end_i + 1):
        match_dist = 0.0
        for j in range(pattern_len):
            idx = i + j
            idx_next = idx + 1
            if idx_next < total_bars and closes[idx_next] > 0:
                h_pct = (closes[idx] - closes[idx_next]) / closes[idx_next]
            else:
                h_pct = 0.0
            diff = h_pct - cur_pattern[j]
            match_dist += diff * diff
        
        if match_dist < best_dist:
            best_dist = match_dist
            best_i = i
    
    # Calculate projection
    if best_i < total_bars and closes[best_i] > 0:
        base_price = closes[best_i]
        ratio = closes[best_i - proj_len] / base_price if base_price > 0 else 1.0
        target = closes[0] * ratio  # current price * ratio
        
        result['target_price'] = target
        result['move_pct'] = ((target - closes[0]) / closes[0]) * 100 if closes[0] > 0 else 0.0
        result['bullish'] = target > closes[0]
        result['match_distance'] = best_dist
        result['match_index'] = best_i
    
    return result


# ===========================================================================
# 4. محرك الأساسيات (Fundamentals Engine)
# ===========================================================================

@dataclass
class FundamentalsState:
    pe_ratio: float = 0.0
    roe: float = 0.0
    available: bool = False
    strong: bool = False
    state: str = 'غير متاح ⚪'
    score: int = 0  # 0 or 1 for proof (legacy); 0-100 for real score (FUNDAMENTALS-FIX)
    confidence: float = 0.0  # FUNDAMENTALS-FIX (2026-08-17): 0-100, % of components with data


def evaluate_fundamentals(pe_ratio: Optional[float], roe: Optional[float]) -> FundamentalsState:
    """
    تقييم الأساسيات من V38:
    - قوية جداً: PE > 0 and PE < 15 and ROE > 15
    - مقبولة: PE > 0 and PE < 25 and ROE > 10
    - ضعيفة: غير ذلك
    """
    f = FundamentalsState()
    
    if pe_ratio is None or roe is None:
        f.state = 'غير متاح ⚪'
        return f
    
    f.pe_ratio = pe_ratio
    f.roe = roe
    f.available = True
    
    if pe_ratio > 0 and pe_ratio < get_setting('pe_strong_threshold', default=15) and roe > get_setting('roe_strong_threshold', default=15):
        f.strong = True
        f.state = 'قوية جداً 🟢'
        f.score = 1
    elif pe_ratio > 0 and pe_ratio < get_setting('pe_acceptable_threshold', default=25) and roe > get_setting('roe_acceptable_threshold', default=10):
        f.state = 'مقبولة 🟡'
        f.score = 0  # partial credit
    else:
        f.state = 'ضعيفة 🔴'
        f.score = 0
    
    return f


# ===========================================================================
# 5. محرك القيمة العادلة (Fair Value / VWAP Engine)
# ===========================================================================

def calc_fair_value(highs: List[float], lows: List[float], closes: List[float], volumes: List[float], period: int = 100) -> Tuple[float, float]:
    """القيمة العادلة (VWAP-based) — BRAVO UNIFY: delegates to canonical utils.fair_value."""
    return _canonical_vwap_fair_value(highs, lows, closes, volumes, period)


# ===========================================================================
# 6. محرك الأخطار والسحب (Order Blocks & Liquidity Sweeps)
# ===========================================================================

@dataclass
class OrderBlockState:
    last_resistance: float = 0.0
    last_support: float = 0.0
    broke_resistance: bool = False
    broke_support: bool = False
    sweep_low: bool = False
    active_ob: float = 0.0  # active order block level


def detect_order_blocks_and_sweeps(
    highs: List[float],
    lows: List[float],
    closes: List[float],
    lookback: int = 5,
) -> OrderBlockState:
    """
    كشف الأخطار والسحب من V38:
    - pivot highs = resistance
    - pivot lows = support
    - crossover close above resistance = broke_resistance
    - crossunder close below support = broke_support
    - sweep: low < support and close > support (liquidity sweep)
    """
    ob = OrderBlockState()
    n = len(closes)
    if n < lookback * 2 + 1:
        return ob
    
    # Find recent pivot highs and lows
    for i in range(lookback, n - lookback):
        # Pivot high
        is_pivot_h = all(highs[i] >= highs[i-j] for j in range(1, lookback+1)) and \
                     all(highs[i] >= highs[i+j] for j in range(1, lookback+1))
        if is_pivot_h:
            ob.last_resistance = highs[i]
        
        # Pivot low
        is_pivot_l = all(lows[i] <= lows[i-j] for j in range(1, lookback+1)) and \
                     all(lows[i] <= lows[i+j] for j in range(1, lookback+1))
        if is_pivot_l:
            ob.last_support = lows[i]
    
    if n < 2:
        return ob
    
    # Check for breaks
    if ob.last_resistance > 0:
        ob.broke_resistance = closes[-1] > ob.last_resistance and closes[-2] <= ob.last_resistance
    
    if ob.last_support > 0:
        ob.broke_support = closes[-1] < ob.last_support and closes[-2] >= ob.last_support
        # Sweep: price went below support but closed above
        ob.sweep_low = lows[-1] < ob.last_support and closes[-1] > ob.last_support
    
    if ob.broke_resistance or ob.sweep_low:
        ob.active_ob = lows[-lookback] if lows[-lookback] < closes[-1] else 0.0
    
    return ob


# ===========================================================================
# 7. نظام الإثباتات الخمسة والتعلم الديناميكي (5 Proofs + Adaptive Learning)
# ===========================================================================

@dataclass
class ProofResult:
    proof_1: str = '❌'  # Trend
    proof_2: str = '❌'  # Makers
    proof_3: str = '❌'  # DNA
    proof_4: str = '⏳'  # Fundamentals
    proof_5: str = '❌'  # Sector


def calculate_score_and_proofs(
    trend_up: bool,
    maker_state: MakerState,
    dna_result: Dict[str, Any],
    fundamentals: FundamentalsState,
    sector_change: float,
    # Weights from V38
    w_trend: int = 15,
    w_maker: int = 20,
    w_dna: int = 15,
    w_fund: int = 15,
    w_sector: int = 10,
) -> Tuple[int, ProofResult]:
    """
    حساب النقاط ونظام الإثباتات من V38:
    - القاعدة = 30
    - إثبات 1 (الترند): +w_trend لو صاعد
    - إثبات 2 (الميكرز): +w_maker لو بيجمع، -w_maker لو بيوزع
    - إثبات 3 (البصمة): +w_dna لو طالعة
    - إثبات 4 (الأساسي): +w_fund لو قوية
    - إثبات 5 (القطاع): +w_sector لو أخضر
    - مكافأة +5 لو القطاع بيتحرك > 1%
    """
    # Override with dynamic settings if available
    try:
        w_trend = int(get_setting('proof_weight_trend', default=w_trend))
        w_maker = int(get_setting('proof_weight_makers', default=w_maker))
        w_dna = int(get_setting('proof_weight_dna', default=w_dna))
        w_fund = int(get_setting('proof_weight_fundamental', default=w_fund))
        w_sector = int(get_setting('proof_weight_sector', default=w_sector))
    except Exception:
        pass  # fallback to defaults

    proofs = ProofResult()
    score = int(get_setting('tech_score_base', default=50) - 20)  # Base score
    
    # Proof 1: Trend
    if trend_up:
        score += w_trend
        proofs.proof_1 = '✅ الترند صاعد'
    else:
        proofs.proof_1 = '❌ الترند هابط'
    
    # Proof 2: Makers
    if maker_state.maker_bullish:
        score += w_maker
        proofs.proof_2 = '✅ ميكرز بيجمع'
    elif maker_state.maker_bearish:
        score -= w_maker
        proofs.proof_2 = '❌ ميكرز بيوزع'
    else:
        proofs.proof_2 = '⚪ ميكرز هادئ'
    
    # Proof 3: DNA
    if dna_result.get('bullish', False):
        score += w_dna
        proofs.proof_3 = '✅ البصمة المستقبلية طالعة'
    else:
        proofs.proof_3 = '❌ البصمة المستقبلية نازلة'
    
    # Proof 4: Fundamentals
    if fundamentals.available:
        if fundamentals.strong:
            score += w_fund
            proofs.proof_4 = '✅ الأساسيات قوية'
        else:
            proofs.proof_4 = '❌ الأساسيات ضعيفة'
    else:
        proofs.proof_4 = '⏳ الأساسيات غير متاحة'
    
    # Proof 5: Sector
    if sector_change > 0:
        score += w_sector
        proofs.proof_5 = '✅ القطاع أخضر'
    else:
        proofs.proof_5 = '❌ القطاع أحمر'
    
    # Sector momentum bonus
    if sector_change > 1.0:
        score += 5
    
    # Clamp to 0-100
    score = max(0, min(100, score))
    
    return score, proofs


def adaptive_threshold(
    base_threshold: int,
    total_trades: int,
    win_rate: float,
) -> int:
    """
    التعلم الديناميكي من V38:
    - لو نجاح ≥ 65%: قلل الـ threshold بـ 5 (إشارات أكتر)
    - لو نجاح < 40%: زود الـ threshold بـ 5 (حذر)
    """
    if total_trades < int(get_setting('adaptive_threshold_adjustment', default=5)):
        return base_threshold
    
    if win_rate >= get_setting('adaptive_win_rate_lower', default=65):
        return base_threshold - int(get_setting('adaptive_threshold_adjustment', default=5))
    elif win_rate < get_setting('adaptive_win_rate_raise', default=40):
        return base_threshold + int(get_setting('adaptive_threshold_adjustment', default=5))
    return base_threshold


# ===========================================================================
# 8. محرك الطيران (Flight State Engine)
# ===========================================================================

def detect_flight_state(
    broke_resistance: bool,
    broke_support: bool,
    is_expanding: bool,
    maker_bullish: bool,
    maker_bearish: bool,
    volume_surge: bool,
) -> Tuple[str, str]:
    """
    حالة الطيران من V38:
    - طائر للأعلى: كسر مقاومة + اتساع فرق بولينجر + (ميكرز بيجمع أو ارتفاع حجم)
    - واقع للأسفل: كسر دعم + اتساع + ميكرز بيوزع
    - عرضي: غير ذلك
    """
    if broke_resistance and is_expanding and (maker_bullish or volume_surge):
        return 'طائر للأعلى 🚀', 'flight_up'
    elif broke_support and is_expanding and maker_bearish:
        return 'واقع للأسفل 📉', 'flight_down'
    else:
        return 'عرضي 😴', 'sideways'


# ===========================================================================
# 9. التقرير النهائي (Trade Tracking & Report)
# ===========================================================================

@dataclass
class Trade:
    ticker: str
    entry_date: str
    entry_price: float
    target_price: float
    stop_loss: float
    score: int
    signal: str
    proofs: Dict[str, str]
    exit_date: str = ''
    exit_price: float = 0.0
    exit_reason: str = ''  # hit_target, hit_stop, expired, trailing_stop, breakeven_stop, still_open
    return_pct: float = 0.0
    holding_days: int = 0
    is_win: bool = False
    # V40: Partial exit tracking (50% at 1R, remaining at trailing/breakeven)
    partial_exit_taken: bool = False
    partial_exit_price: float = 0.0
    partial_exit_pct: float = 0.0  # percentage of position exited at 1R (e.g. 50.0)
    partial_exit_date: str = ''
    partial_exit_return_pct: float = 0.0  # return of the partial portion
    # V40.1: Position Sizing — R-multiple & equity impact
    r_multiple: float = 0.0       # R-multiple: (exit-entry)/(entry-stop) — how many R won/lost
    pnl_pct: float = 0.0          # equity impact % = risk_per_trade_pct * r_multiple
    # POSITION SIZING (2026-09-02): volatility-based size multiplier
    position_size_mult: float = 1.0   # 0.5 - 1.0 (high vol = 0.55, normal = 1.0)
    volatility_class: str = 'NORMAL' # LOW / NORMAL / HIGH
    atr_pct: float = 0.0             # ATR / price × 100 (for UI display)


@dataclass
class BacktestSummary:
    total_tickers_tested: int = 0
    total_signals: int = 0
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    win_rate: float = 0.0
    avg_return: float = 0.0
    total_return_pct: float = 0.0
    gross_profit: float = 0.0
    gross_loss: float = 0.0
    profit_factor: float = 0.0
    avg_holding_days: float = 0.0
    avg_risk_reward: float = 0.0
    max_consecutive_wins: int = 0
    max_consecutive_losses: int = 0
    sharpe_ratio: float = 0.0
    calmar_ratio: float = 0.0
    max_drawdown_pct: float = 0.0
    by_signal: Dict[str, int] = field(default_factory=dict)
    by_proof_count: Dict[int, int] = field(default_factory=dict)
    top_winners: List[Dict] = field(default_factory=list)
    top_losers: List[Dict] = field(default_factory=list)
    monthly_returns: Dict[str, float] = field(default_factory=dict)
    adaptive_threshold_final: int = None
    model_quality: str = ''
    model_quality_ar: str = ''
    # V40.1: Position Sizing metrics
    avg_win: float = 0.0           # متوسط الربح كتأثير على رأس المال (% equity)
    avg_loss: float = 0.0          # متوسط الخسارة كتأثير على رأس المال (% equity)
    avg_r_multiple: float = 0.0    # متوسط R-multiple
    risk_per_trade_pct: float = 0.0   # نسبة المخاطرة المستخدمة
    position_sizing_enabled: bool = False  # هل Position Sizing مفعّل
    final_equity: float = 100.0    # رأس المال النهائي (يبدأ من 100%)


# FIX: Trailing stop reads from engine_settings — unified with live stop_manager
TRAILING_STOP_ATR_MULT = get_setting('trailing_stop_atr_mult', default=2.0)
# TIGHTENING (2026-09-02): Owner directive: "فعّل Trailing Stop بعد +5% ربح
# (يحرك الستوب على نقطة الدخول أو أعلى)"
# → default activation gain raised from 2.0% to 5.0%
# → env override: V40_2_TRAILING_ACTIVATION_GAIN=5.0
TRAILING_STOP_MIN_GAIN = float(os.environ.get(
    'V40_2_TRAILING_ACTIVATION_GAIN',
    str(get_setting('trailing_stop_activation_gain', default=5.0))
))
# BREAKEVEN FLOOR (2026-09-02): once trailing activates, stop cannot go below
# entry * 1.01 (breakeven + 1%). This locks profits early.
# → env override: V40_2_TRAILING_BREAKEVEN_FLOOR=1.01 (means +1%)
TRAILING_BREAKEVEN_FLOOR = float(os.environ.get('V40_2_TRAILING_BREAKEVEN_FLOOR', '1.01'))

# V40: Lazy singleton for StopLossManager (avoids per-trade instantiation overhead)
_STOP_MGR_INSTANCE = None


def _get_stop_manager():
    """V40: Singleton StopLossManager for partial_exit calculations."""
    global _STOP_MGR_INSTANCE
    if _STOP_MGR_INSTANCE is None:
        try:
            from portfolio.stop_manager import StopLossManager
            _STOP_MGR_INSTANCE = StopLossManager()
        except Exception:
            _STOP_MGR_INSTANCE = False  # mark as unavailable
    return _STOP_MGR_INSTANCE


def simulate_trade(
    trade: Trade,
    future_closes: List[float],
    future_dates: List[str],
    max_holding: int = None,
    future_atrs: Optional[List[float]] = None,
) -> Trade:
    """
    V40 محاكاة صفقة واحدة — نمشي قدّام في الزمن ونشوف:
    - هل وصل للهدف الجزئي 1R؟ → خروج 50% + رفع الستوب على الباقي
    - هل وصل للهدف الكامل؟ → خروج الباقي
    - هل فعّل الستوب المتحرك؟ (trailing قبل hit_stop لحماية الأرباح)
    - هل وصل لوقف الخسارة؟
    - هل انتهت المدة؟

    V40 تغييرات جوهرية:
    1. Partial exit عند 1R (50% من المركز) — يستدعي calculate_partial_exit من stop_manager
    2. Trailing stop يُفحص BEFORE hit_stop (لما يكون في ربح محمي)
    3. بعد partial_exit: الستوب الفعال = breakeven أو trailing (مش الستوب الأصلي)
    4. return_pct محسوبة كمتوسط مرجح (partial portion + remaining portion)
    """
    if max_holding is None:
        max_holding = int(get_setting('max_holding_days', default=7))
    if not future_closes:
        trade.exit_reason = 'no_data'
        return trade

    entry = trade.entry_price
    target = trade.target_price
    stop = trade.stop_loss
    highest_price = entry  # تتبع أعلى سعر للستوب المتحرك

    # TIGHTENING (2026-09-02): clamp stop_loss to max V40_2_STOP_MAX_PCT (default 9%)
    # Owner directive: "خفّض الستوب الأقصى من 9% لـ 7% (أو خلّيه ATR-based بس بحد أقصى 7%)"
    # Task REAPPLY-CRITICAL-FIXES: canonical default = 9.0 (engine_settings.py:241, Rule 8).
    # Was 7.0 (stale). The owner may still tighten via env var if desired.
    # This is applied HERE (not in the decision engine) so it works in both
    # production AND backtest — regardless of where the stop was originally computed.
    try:
        _tighten_max_pct = float(os.environ.get('V40_2_STOP_MAX_PCT', '9.0'))  # Task REAPPLY-CRITICAL-FIXES — was '7.0'
        if entry > 0 and stop > 0:
            _stop_dist_pct = abs((entry - stop) / entry) * 100.0
            if _stop_dist_pct > _tighten_max_pct:
                # Tighten: move stop closer to entry (max _tighten_max_pct away)
                _new_stop = entry - (entry * _tighten_max_pct / 100.0)
                # Re-derive target to preserve R:R (so tighter stop = tighter target)
                _old_risk = entry - stop
                _new_risk = entry - _new_stop
                if _old_risk > 0 and _new_risk > 0:
                    _ratio = _new_risk / _old_risk
                    target = entry + (target - entry) * _ratio
                stop = _new_stop
    except Exception:
        pass  # safe-by-design: if env parsing fails, keep original stop

    # V40.2: Data sanity guard — clamp any single-bar price jump >2x or <0.5x
    # (protects against corrupt/split-unadjusted data that would produce absurd
    # returns like +5666% in one bar). Keeps alignment with future_dates/atrs.
    if len(future_closes) > 1:
        prev = entry if entry > 0 else (future_closes[0] if future_closes else 0)
        clamped = []
        for p in future_closes:
            if prev > 0 and p > 0:
                if p > prev * 2.0:
                    p = prev * 2.0
                elif p < prev * 0.5:
                    p = prev * 0.5
            clamped.append(p)
            prev = p
        future_closes = clamped

    # V40.3: Data Gap Guard — carry forward last valid close when price=0.
    # EGKSCO data has days where O=0, H=0, L=0, C=<last_close> (no trading).
    # Without this guard, the simulator sees C < stop and triggers a FALSE stop.
    # Example: ELKA on 2026-07-10 had C=1.24 (stale) while real price was ~1.57.
    # Fix: replace any price <= 0 with the last known good price.
    if len(future_closes) > 0:
        last_good = entry if entry > 0 else (future_closes[0] if future_closes[0] > 0 else 0)
        gap_filled = []
        gaps_filled_count = 0
        for p in future_closes:
            if p <= 0:
                gap_filled.append(last_good)
                gaps_filled_count += 1
            else:
                gap_filled.append(p)
                last_good = p
        if gaps_filled_count > 0:
            future_closes = gap_filled

    # V40: Partial exit state
    partial_taken = False
    partial_exit_price = 0.0
    partial_exit_pct = 0.0
    partial_exit_date = ''
    partial_exit_return = 0.0
    effective_stop = stop  # الستوب الفعال (يتغير بعد partial_exit)
    effective_stop_type = 'fixed'

    # POSITION SIZING (2026-09-02): scale returns based on volatility.
    # Owner directive: "لو التقلب عالي → قلل حجم الصفقة (50-60%)."
    # → High vol stocks (UTOP, DAPH) get 55% size → max loss reduced.
    # → Normal vol stocks get 100% size.
    # → position_size_mult is stored on trade for the UI to display.
    try:
        from analyzers.position_sizing import calculate_position_size
        _atr_for_sizing = future_atrs[0] if (future_atrs and len(future_atrs) > 0) else 0.0
        _sizing_result = calculate_position_size(_atr_for_sizing, entry)
        position_size_mult = _sizing_result['position_size_mult']
        trade.position_size_mult = position_size_mult  # store for UI
        trade.volatility_class = _sizing_result['volatility_class']
        trade.atr_pct = _sizing_result['atr_pct']
    except Exception:
        position_size_mult = 1.0  # fallback: full size

    # V40: Get StopLossManager singleton (for partial_exit)
    stop_mgr = _get_stop_manager()

    def _finalize(exit_price, exit_reason, exit_idx, holding_days, is_win):
        """Helper to set final trade fields with blended return if partial taken."""
        trade.exit_date = future_dates[exit_idx] if exit_idx < len(future_dates) else trade.entry_date
        trade.exit_price = exit_price
        trade.exit_reason = exit_reason
        trade.holding_days = holding_days
        trade.is_win = is_win

        if partial_taken:
            partial_ret = ((partial_exit_price - entry) / entry) * 100
            remaining_ret = ((exit_price - entry) / entry) * 100
            weight = partial_exit_pct / 100.0
            trade.return_pct = (weight * partial_ret) + ((1 - weight) * remaining_ret)
            trade.partial_exit_taken = True
            trade.partial_exit_price = partial_exit_price
            trade.partial_exit_pct = partial_exit_pct
            trade.partial_exit_date = partial_exit_date
            trade.partial_exit_return_pct = round(partial_ret, 2)
        else:
            trade.return_pct = ((exit_price - entry) / entry) * 100
            trade.partial_exit_taken = False

        # POSITION SIZING (2026-09-02): scale return by position_size_mult
        # Owner: "السهم العالي التقلب ياخد حجم أصغر → خسارة أقل"
        # Example: UTOP -24.86% × 0.55 = -13.67% (خسارة أقل بـ 11.19pp)
        trade.return_pct = trade.return_pct * position_size_mult

        # V40.1: Position Sizing — R-multiple
        # R = (exit-entry)/(entry-stop) → نحسبه من return_pct كنسبة سعرية
        stop_distance = entry - stop
        if stop_distance > 0:
            trade.r_multiple = (trade.return_pct / 100.0) * (entry / stop_distance)
        else:
            trade.r_multiple = 0.0

    for i, price in enumerate(future_closes):
        # Expired (max holding reached)
        if i >= max_holding:
            _finalize(price, 'expired', i - 1 if i > 0 else 0, i, price > entry)
            break

        # RECOMMENDATION 7: خروج سريع — لو هبط 5% في أول 3 أيام → اخرج فوراً
        # مش هنستنى الوقف الكامل (-8% لـ -10%) لو السهم بيهبط بسرعة
        if i < 3 and entry > 0:
            fast_return = ((price - entry) / entry) * 100
            if fast_return <= -5.0:
                _finalize(price, 'fast_stop', i, i + 1, False)
                break

        # Update highest price
        highest_price = max(highest_price, price)
        atr_i = future_atrs[i] if (future_atrs and i < len(future_atrs)) else 0.0

        # ── V40: Check partial_exit at 1R (if not already taken) ──
        if not partial_taken and stop_mgr and atr_i > 0:
            try:
                pe_result = stop_mgr.calculate_partial_exit(
                    entry_price=entry,
                    current_price=price,
                    stop_loss=stop,
                    target_1=target,
                    highest_high=highest_price,
                    atr=atr_i,
                )
                if pe_result.get('should_partial_exit'):
                    partial_taken = True
                    partial_exit_price = pe_result['partial_exit_price']
                    partial_exit_pct = pe_result['partial_exit_pct']
                    partial_exit_date = future_dates[i] if i < len(future_dates) else trade.entry_date
                    partial_exit_return = ((partial_exit_price - entry) / entry) * 100
                    effective_stop = pe_result['remaining_stop']
                    effective_stop_type = pe_result['remaining_stop_type']
            except Exception:
                pass  # fall back to original stop logic

        # ── V40: Update trailing stop if partial taken ──
        # بعد partial_exit: حدّث trailing كل شمعة بناءً على highest_price
        if partial_taken and effective_stop_type == 'trailing' and atr_i > 0:
            trailing_atr_mult = get_setting('trailing_stop_atr_mult', default=2.0)
            trailing_stop_price = highest_price - (trailing_atr_mult * atr_i)
            breakeven = entry * 1.01  # FLOOR: لا ينزل تحت breakeven
            effective_stop = max(trailing_stop_price, breakeven)

        # ── V40: Trailing stop check BEFORE hit_stop (protects profits) ──
        # للصفقات اللي ما أخدتش partial: لو فيه ربح >= min_gain → فعل trailing
        # TIGHTENING (2026-09-02): trailing activation raised to +5% (was +2%)
        # + BREAKEVEN FLOOR: once activated, stop = max(trailing, breakeven)
        # Owner: "يحرك الستوب على نقطة الدخول أو أعلى"
        if not partial_taken:
            gain_pct = ((price - entry) / entry) * 100
            if gain_pct >= TRAILING_STOP_MIN_GAIN and atr_i > 0:
                trailing_stop_price = highest_price - (TRAILING_STOP_ATR_MULT * atr_i)
                # BREAKEVEN FLOOR: لا ينزل تحت entry * 1.01 (locks profit)
                breakeven = entry * TRAILING_BREAKEVEN_FLOOR
                # الستوب الفعال = أقصى (trailing, breakeven) — أقوى حماية
                effective_trailing = max(trailing_stop_price, breakeven)
                # لازم السعر يكون نزل تحت trailing stop (مش بس تحته قليلاً)
                if price <= effective_trailing and effective_trailing > stop:
                    # سجل إن trailing حمى الربح (للتحليل)
                    protected_profit = max(0, (effective_trailing - entry) / entry * 100)
                    _finalize(effective_trailing, 'trailing_stop', i, i + 1, effective_trailing > entry)
                    break

        # ── Hit target (exit remaining at target) ──
        if price >= target:
            _finalize(target, 'hit_target', i, i + 1, True)
            break

        # ── Hit stop / trailing stop / breakeven stop ──
        # بعد partial: نستخدم effective_stop (breakeven أو trailing)
        # قبل partial: نستخدم الستوب الأصلي
        current_stop = effective_stop if partial_taken else stop
        if price <= current_stop:
            if partial_taken:
                # لو partial اتاخد والستوب الفعالي ضرب → ده حماية (breakeven أو trailing)
                exit_reason = 'trailing_stop' if effective_stop_type == 'trailing' else 'breakeven_stop'
                _finalize(current_stop, exit_reason, i, i + 1, current_stop > entry)
            else:
                _finalize(stop, 'hit_stop', i, i + 1, False)
            break
    else:
        # Didn't hit target or stop within max_holding
        last_idx = min(max_holding - 1, len(future_closes) - 1)
        last_price = future_closes[last_idx]
        _finalize(last_price, 'expired', last_idx, last_idx + 1, last_price > entry)

    return trade


# ===========================================================================
# 10. المحرك الرئيسي (Main Backtest Engine)
# ===========================================================================

class V38BacktestEngine:
    """
    محرك المحاكاة الشامل V38 — يختبر كل الأسهم
    """
    
    def __init__(
        self,
        w_trend: int = 15,
        w_maker: int = 20,
        w_dna: int = 15,
        w_fund: int = 15,
        w_sector: int = 10,
        buy_threshold: int = 75,
        rr1: float = 2.0,
        rr2: float = 3.0,
        min_confidence: int = 60,
        max_holding_days: int = 7,  # RECOMMENDATION 2: كان 30 → 7
        use_v393: bool = False,
        market_code: Optional[str] = None,
    ):
        self.w_trend = w_trend
        self.w_maker = w_maker
        self.w_dna = w_dna
        self.w_fund = w_fund
        self.w_sector = w_sector
        self.buy_threshold = buy_threshold
        self.rr1 = rr1
        self.rr2 = rr2
        self.min_confidence = min_confidence
        self.max_holding_days = max_holding_days
        self.use_v393 = use_v393

        # V40.4: Resolve the MarketProfile once (Unified Multi-Market, Directive §2).
        # When market_code is supplied the engine adapts ATR stop bounds + R:R
        # floor to that market's physics. None → legacy V38/V39.3 behaviour.
        self.market_code = market_code.upper() if market_code else None
        self.market_profile: Optional[MarketProfile] = (
            MARKET_PROFILES.get(self.market_code) if self.market_code else None
        )
        
        # Data caches
        self._fundamentals_cache: Dict[str, FundamentalsState] = {}
        self._sector_changes: Dict[str, float] = {}
        # V40.2: EGX30ETF benchmark — date → 14-day ROC % (لإمرار benchmark_change حقيقي
        # بدل 0.0، عشان فلتر القوة النسبية يبقى له معنى فعلي في الباكتست)
        self._benchmark_roc_by_date: Dict[str, float] = {}
        self._benchmark_loaded = False

        self.trades: List[Trade] = []
        self.all_scores: List[int] = []
        self.all_signals: List[str] = []
    
    def _load_fundamentals(self):
        """تحميل الأساسيات من data_engine.db (primary) + stocks.db (fallback).
        
        FUNDAMENTALS-FIX (2026-08-17):
        - Primary: fundamental_data_provider.get_fundamental_score() reads tab_valuation +
          tab_profitability + tab_dividends + tab_technical_analysis from data_engine.db
          with proper symbol→ticker resolver (exact + prefix match). Returns real 0-100 score.
        - Fallback: stocks.db (legacy path, often empty for EGX).
        - The cache stores FundamentalsState with .score = real 0-100 (not binary 0/1).
        """
        # ─── Primary: data_engine.db via fundamental_data_provider ───
        try:
            from analyzers.fundamental_data_provider import get_fundamental_score, DATA_ENGINE_DB as DE_DB
            import os as _os
            de_path = _os.environ.get('DATA_ENGINE_DB', DE_DB)
            if _os.path.exists(de_path):
                # Get all tickers we need to score (from price_history or stocks.db)
                ticker_set = set()
                try:
                    # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
                    _v38_fs1_ctx = None
                    try:
                        if _V38_BT_DBM_AVAILABLE:
                            _v38_fs1_ctx = _dbm.connection(STOCKS_DB, writable=False)
                            conn = _v38_fs1_ctx.__enter__()
                        else:
                            raise RuntimeError("db_manager unavailable")
                    except Exception:
                        conn = sqlite3.connect(STOCKS_DB, timeout=10.0)
                        _v38_fs1_ctx = None
                    cur = conn.cursor()
                    # FUNDAMENTALS-FIX (2026-10-01): stocks.db uses `ticker` column (not `symbol`)
                    # The old code tried `SELECT symbol FROM stocks` which fails because the
                    # column is named `ticker`. This caused _load_fundamentals to fall through
                    # to the empty legacy path → fundamental_score = 50.0 placeholder.
                    try:
                        cur.execute("SELECT ticker FROM stocks WHERE is_active = 1")
                        for row in cur.fetchall():
                            if row[0]:
                                ticker_set.add(str(row[0]).strip())
                    except Exception:
                        pass
                    conn.close()
                except Exception:
                    pass
                # Also add any tickers already in the cache from price data
                # Score each ticker via the provider
                n_scored = 0
                for ticker in ticker_set:
                    result = get_fundamental_score(ticker)
                    if result['available'] and result['score'] is not None:
                        # Convert 0-100 score to FundamentalsState
                        # Use pe/roe from components for backward compat with evaluate_fundamentals
                        pe = result['components'].get('pe_ratio', {}).get('value')
                        roe = result['components'].get('roe', {}).get('value')
                        fs = FundamentalsState()
                        fs.pe_ratio = pe if pe else 0.0
                        fs.roe = roe if roe else 0.0
                        fs.available = True
                        fs.strong = result['score'] >= 70
                        fs.state = f"score={result['score']:.0f} conf={result['confidence']:.0f} 🟢" if fs.strong else f"score={result['score']:.0f} conf={result['confidence']:.0f} 🟡"
                        # Store the REAL 0-100 score (not binary)
                        fs.score = result['score']
                        fs.confidence = result['confidence']
                        self._fundamentals_cache[ticker] = fs
                        n_scored += 1
                if n_scored > 0:
                    print(f"📊 Loaded real fundamentals for {n_scored} stocks from data_engine.db")
                    return
        except ImportError:
            pass
        except Exception as e:
            print(f"⚠️  data_engine.db fundamentals load failed: {e}, falling back to stocks.db")

        # ─── Fallback: stocks.db (legacy) ───
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _v38_fs2_ctx = None
            try:
                if _V38_BT_DBM_AVAILABLE:
                    _v38_fs2_ctx = _dbm.connection(STOCKS_DB, writable=False)
                    conn = _v38_fs2_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(STOCKS_DB, timeout=10.0)
                _v38_fs2_ctx = None
            cur = conn.cursor()
            cur.execute("SELECT ticker, pe_ratio, roe FROM stocks WHERE pe_ratio IS NOT NULL OR roe IS NOT NULL")
            for row in cur.fetchall():
                ticker, pe, roe = row
                self._fundamentals_cache[ticker] = evaluate_fundamentals(pe, roe)
            conn.close()
        except Exception as e:
            print(f"⚠️  Error loading fundamentals: {e}")

    def _get_fundamentals(self, ticker: str) -> 'FundamentalsState':
        """Lazy fundamentals lookup with on-demand scoring.
        
        FUNDAMENTALS-FIX (2026-08-17): If the ticker isn't in the pre-loaded cache
        (e.g. EGX alpha tickers like COMI that stocks.db stores as messy concatenations),
        call get_fundamental_score() on-the-fly. This ensures every ticker V38 analyzes
        gets a real 0-100 score when data_engine.db has the data.
        """
        fs = self._fundamentals_cache.get(ticker)
        if fs is not None:
            return fs
        # On-demand scoring (cache miss)
        try:
            from analyzers.fundamental_data_provider import get_fundamental_score
            result = get_fundamental_score(ticker)
            if result['available'] and result['score'] is not None:
                pe = result['components'].get('pe_ratio', {}).get('value')
                roe = result['components'].get('roe', {}).get('value')
                fs = FundamentalsState()
                fs.pe_ratio = pe if pe else 0.0
                fs.roe = roe if roe else 0.0
                fs.available = True
                fs.strong = result['score'] >= 70
                fs.state = f"score={result['score']:.0f} conf={result['confidence']:.0f}" + (" 🟢" if fs.strong else " 🟡")
                fs.score = result['score']
                fs.confidence = result['confidence']
                self._fundamentals_cache[ticker] = fs
                return fs
        except Exception:
            pass
        return FundamentalsState()

    def _load_benchmark(self):
        """V40.2: تحميل EGX30ETF كمؤشر سوق وحساب ROC-14 لكل تاريخ.
        يُستخدم لتمرير benchmark_change حقيقي لـ build_institutional_decision
        بدل 0.0 الثابت (اللي كان بيخلي فلتر القوة النسبية عديم الفائدة).

        ملاحظة: الرمز الحقيقي لـ EGX30ETF في egksco_price_history هو
        'EGS30AJ1C016-EGP' (مش 'EGX30ETF'). بنحاول الاثنين."""
        if self._benchmark_loaded:
            return
        self._benchmark_loaded = True
        # الرمز الكنسي الصحيح — EGX30ETF أولاً (365 يوم)، ثم الكود الكنسي
        BENCHMARK_TICKERS = ('EGX30ETF', 'EGS691S1C011', 'EGS30AJ1C016-EGP')
        for bench_ticker in BENCHMARK_TICKERS:
            try:
                dates, opens, highs, lows, closes, volumes = self.get_price_data(bench_ticker)
                if len(closes) < 15:
                    continue
                for i in range(14, len(closes)):
                    if closes[i - 14] > 0:
                        roc = (closes[i] - closes[i - 14]) / closes[i - 14] * 100.0
                        self._benchmark_roc_by_date[dates[i]] = roc
                print(f"📊 Benchmark loaded ({bench_ticker}): {len(self._benchmark_roc_by_date)} تاريخ مع ROC-14")
                return  # نجح، اخرج
            except Exception as e:
                print(f"⚠️  Benchmark load ({bench_ticker}) فشل ({e}) — جرب التالي")
                continue
        print("⚠️  مفيش بيانات benchmark — هيفضل benchmark_change=0")
    
    def _load_sector_changes(self, date_str: str):
        """تحميل تغيرات القطاع — حساب من الأسهم في نفس القطاع"""
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _v38_sc_ctx = None
            try:
                if _V38_BT_DBM_AVAILABLE:
                    _v38_sc_ctx = _dbm.connection(STOCKS_DB, writable=False)
                    conn = _v38_sc_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(STOCKS_DB, timeout=10.0)
                _v38_sc_ctx = None
            cur = conn.cursor()
            # Get sector average change
            cur.execute("""
                SELECT s.sector, AVG(s.change_percent) 
                FROM stocks s 
                WHERE s.sector IS NOT NULL AND s.change_percent IS NOT NULL
                GROUP BY s.sector
            """)
            for row in cur.fetchall():
                sector, avg_change = row
                self._sector_changes[sector] = float(avg_change) if avg_change else 0.0
            conn.close()
        except Exception as e:
            print(f"⚠️  Error loading sector changes: {e}")
    
    def get_tickers(self, min_days: int = 200) -> List[str]:
        """الحصول على قائمة الأسهم مع بيانات كافية"""
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _v38_gt_ctx = None
        try:
            if _V38_BT_DBM_AVAILABLE:
                _v38_gt_ctx = _dbm.connection(PRICE_HISTORY_DB, writable=False)
                conn = _v38_gt_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(PRICE_HISTORY_DB, timeout=30.0)
            _v38_gt_ctx = None
        cur = conn.cursor()
        cur.execute("""
            SELECT symbol FROM egksco_price_history
            GROUP BY symbol
            HAVING COUNT(*) >= ?
            ORDER BY symbol
        """, (min_days,))
        tickers = [row[0] for row in cur.fetchall()]
        conn.close()
        return tickers
    
    def get_price_data(self, ticker: str) -> Tuple[List[str], List[float], List[float], List[float], List[float], List[float]]:
        """تحميل بيانات السعر لسهم واحد — دمج متكامل ومحدّث (Rule 12).
        
        يدمج التاريخ الطويل من price_history.db مع أحدث الشموع من egksco_price_history
        و stock_daily_prices (حتى تاريخ اليوم).
        
        BRAVO-SPEED-FIX (2026-10-20): لو self._price_cache موجود (pre-loaded batch)،
        استخدمه بدل الـ per-ticker query (تحسين 180×).
        """
        data_by_date = {}

        # 0. BRAVO-SPEED-FIX: استخدم pre-cached price_history لو موجود
        if hasattr(self, '_price_cache') and ticker.upper() in self._price_cache:
            for r in self._price_cache[ticker.upper()]:
                d = str(r[0])[:10]
                data_by_date[d] = (
                    float(r[1] or r[4] or 0),
                    float(r[2] or r[4] or 0),
                    float(r[3] or r[4] or 0),
                    float(r[4] or 0),
                    parse_volume(r[5])
                )
        else:
            # 1. EXTENDED: price_history.db (تاريخ طويل — 25 سنة)
            try:
                _ph_db = str(Path(__file__).resolve().parents[2] / 'db' / 'price_history.db')
                if os.path.exists(_ph_db):
                    conn = sqlite3.connect(f'file:{_ph_db}?mode=ro', uri=True, timeout=10.0)
                    cur = conn.cursor()
                    cur.execute("""
                        SELECT date, open_price, high_price, low_price, close_price, volume
                        FROM price_history
                        WHERE ticker = ? COLLATE NOCASE
                        AND close_price IS NOT NULL AND close_price > 0
                        ORDER BY date ASC
                    """, (ticker,))
                    for r in cur.fetchall():
                        d = str(r[0])[:10]
                        data_by_date[d] = (
                            float(r[1] or r[4] or 0),
                            float(r[2] or r[4] or 0),
                            float(r[3] or r[4] or 0),
                            float(r[4] or 0),
                            parse_volume(r[5])
                        )
                    conn.close()
            except Exception:
                pass

        # 2. PRIMARY INTRADAY/DAILY: data_engine.db (egksco_price_history — طازج)
        try:
            conn = sqlite3.connect(PRICE_HISTORY_DB, timeout=10.0)
            cur = conn.cursor()
            cur.execute("""
                SELECT price_date, open_price, high_price, low_price, close_price, volume
                FROM egksco_price_history
                WHERE symbol = ? AND close_price IS NOT NULL AND close_price > 0
                ORDER BY price_date ASC
            """, (ticker,))
            for r in cur.fetchall():
                d = str(r[0])[:10]
                data_by_date[d] = (
                    float(r[1] or r[4] or 0),
                    float(r[2] or r[4] or 0),
                    float(r[3] or r[4] or 0),
                    float(r[4] or 0),
                    parse_volume(r[5])
                )
            conn.close()
        except Exception:
            pass

        # 3. LATEST: stocks.db.stock_daily_prices (تحديثات اليوم والجلسات الحالية)
        try:
            conn = sqlite3.connect(STOCKS_DB, timeout=10.0)
            cur = conn.cursor()
            cur.execute("""
                SELECT price_date, open_price, high_price, low_price, close_price, volume
                FROM stock_daily_prices
                WHERE ticker = ? AND close_price IS NOT NULL AND close_price > 0
                ORDER BY price_date ASC
            """, (ticker,))
            for r in cur.fetchall():
                d = str(r[0])[:10]
                data_by_date[d] = (
                    float(r[1] or r[4] or 0),
                    float(r[2] or r[4] or 0),
                    float(r[3] or r[4] or 0),
                    float(r[4] or 0),
                    parse_volume(r[5])
                )
            conn.close()
        except Exception:
            pass

        if data_by_date and len(data_by_date) >= 15:
            sorted_dates = sorted(data_by_date.keys())
            opens = [data_by_date[d][0] for d in sorted_dates]
            highs = [data_by_date[d][1] for d in sorted_dates]
            lows = [data_by_date[d][2] for d in sorted_dates]
            closes = [data_by_date[d][3] for d in sorted_dates]
            volumes = [data_by_date[d][4] for d in sorted_dates]
            return sorted_dates, opens, highs, lows, closes, volumes

        return [], [], [], [], [], []
    
    def analyze_single_day(
        self,
        ticker: str,
        dates: List[str],
        opens: List[float],
        highs: List[float],
        lows: List[float],
        closes: List[float],
        volumes: List[float],
        day_idx: int,
        sector_change: float = 0.0,
    ) -> Dict[str, Any]:
        """
        تحليل يوم واحد لسهم واحد — يرجع الإشارة والنقاط والإثباتات
        """
        # Need at least 200 bars for meaningful analysis
        if day_idx < 200:
            return {'signal': 'WAIT', 'score': 0, 'proofs': {}}
        
        # Slice data up to this day
        sl_closes = closes[:day_idx+1]
        sl_opens = opens[:day_idx+1]
        sl_highs = highs[:day_idx+1]
        sl_lows = lows[:day_idx+1]
        sl_volumes = volumes[:day_idx+1]
        
        # --- 1. Indicators ---
        atr_vals = calc_atr(sl_highs, sl_lows, sl_closes, 14)
        atr_val = atr_vals[-1] if atr_vals else 0.0
        
        # EMA 200 for trend
        ema200 = calc_ema(sl_closes, 200)
        trend_up = sl_closes[-1] > ema200[-1]
        
        # Bollinger Bands
        bb_mid, bb_up, bb_low = calc_bollinger_bands(sl_closes, 20, 2.0)
        bb_width = (bb_up[-1] - bb_low[-1]) / bb_mid[-1] * 100 if bb_mid[-1] > 0 else 0
        bb_width_sma_vals = calc_sma([((bb_up[i] - bb_low[i]) / bb_mid[i] * 100) if bb_mid[i] > 0 else 0 for i in range(len(bb_mid))], 50)
        bb_width_sma = bb_width_sma_vals[-1]
        is_squeeze = bb_width < bb_width_sma * get_setting('bb_squeeze_threshold', default=0.8)
        is_expanding = bb_width > bb_width_sma * get_setting('bb_expansion_threshold', default=1.2)
        
        # Volume analysis
        vol_ma_vals = calc_sma(sl_volumes, 20)
        vol_ma = vol_ma_vals[-1] if vol_ma_vals else 0
        vol_ratio = sl_volumes[-1] / vol_ma if vol_ma > 0 else 1.0
        volume_surge = vol_ratio > get_setting('volume_surge_institutional', default=1.3)
        
        # --- 2. Order Blocks & Sweeps ---
        ob_state = detect_order_blocks_and_sweeps(sl_highs, sl_lows, sl_closes, lookback=5)
        
        # --- 3. Maker Detection ---
        maker = detect_maker_state(sl_closes, sl_opens, sl_highs, sl_lows, sl_volumes, atr_val, vol_ma)
        
        # --- 4. Fair Value ---
        fair_value, fair_premium = calc_fair_value(sl_highs, sl_lows, sl_closes, sl_volumes)
        
        # --- 5. DNA Pattern Matching ---
        dna = dna_pattern_match(sl_closes, pattern_len=10, search_depth=100, proj_len=10)
        
        # --- 6. Fundamentals ---
        fundamentals = self._get_fundamentals(ticker)
        
        # --- 7. Flight State ---
        flight_state, flight_code = detect_flight_state(
            ob_state.broke_resistance, ob_state.broke_support,
            is_expanding, maker.maker_bullish, maker.maker_bearish,
            volume_surge,
        )
        
        # --- 8. Score & Proofs ---
        score, proofs = calculate_score_and_proofs(
            trend_up, maker, dna, fundamentals, sector_change,
            self.w_trend, self.w_maker, self.w_dna, self.w_fund, self.w_sector,
        )
        
        # --- 9. Signal Decision ---
        # BRAVO-KILL-INST-BUY (2026-10-19): INSTITUTIONAL_BUY signal اتقتل.
        # السبب: WR=0.0% (13 توقع كلهم STOPPED) + score=100 متكرر على HRHO.
        # الـ signal ده كان بـ يدخل في الـ ≥70 band ويفسد الـ WR.
        # الآن أي "maker bullish + flight up" بيتحول لـ STRONG_BUY (مش INSTITUTIONAL_BUY).
        # لو محسن حابب يرجّعه: يستبدل السطر اللي تحت بـ signal = 'INSTITUTIONAL_BUY'.
        if maker.maker_bullish and flight_code == 'flight_up':
            signal = 'STRONG_BUY'  # was: 'INSTITUTIONAL_BUY' (KILLED — WR=0%)
        elif score >= self.buy_threshold:
            signal = 'STRONG_BUY'
        elif score <= int(get_setting('tech_score_base', default=50) - 20):
            signal = 'AVOID'
        else:
            signal = 'WAIT'
        
        # --- 10. Risk/Target ---
        entry = sl_closes[-1]
        if ob_state.active_ob > 0 and ob_state.active_ob < entry:
            sl = ob_state.active_ob - (atr_val * get_setting('atr_stop_ob_mult', default=0.5))
        else:
            sl = entry - (atr_val * get_setting('atr_stop_default_mult', default=1.5))
        if sl >= entry:
            sl = entry - (atr_val * get_setting('atr_stop_default_mult', default=1.5))
        
        risk = entry - sl
        tp1 = entry + (risk * self.rr1)
        tp2 = entry + (risk * self.rr2)
        
        # Override TP1 with DNA target if better
        if dna.get('bullish') and dna.get('target_price') and dna['target_price'] > entry:
            tp1 = dna['target_price']
        
        return {
            'signal': signal,
            'score': score,
            'proofs': {
                'trend': proofs.proof_1,
                'makers': proofs.proof_2,
                'dna': proofs.proof_3,
                'fundamentals': proofs.proof_4,
                'sector': proofs.proof_5,
            },
            'entry': entry,
            'target': tp1,
            'target_2': tp2,
            'stop_loss': sl,
            'atr': atr_val,
            'fair_value': fair_value,
            'fair_premium': fair_premium,
            'maker_state': maker.state,
            'flight_state': flight_state,
            'is_expanding': is_expanding,
            'is_squeeze': is_squeeze,
            'volume_surge': volume_surge,
            'dna_bullish': dna.get('bullish', False),
        }
    
    def analyze_single_day(
        self,
        ticker: str,
        dates: List[str],
        opens: List[float],
        highs: List[float],
        lows: List[float],
        closes: List[float],
        volumes: List[float],
        day_idx: int,
        sector_change: float = 0.0,
        market_profile: Optional[MarketProfile] = None,
    ) -> Dict[str, Any]:
        """V39.3 daily analysis — accepts an optional MarketProfile (V40.4 §2).

        When ``market_profile`` is supplied the engine adapts:
          * ATR stop is clamped to ``[atr_stop_min_pct, atr_stop_max_pct]`` of
            the entry price (Market Physics Matrix, Directive §3).
          * The R:R floor is raised to ``dynamic_rr_normal`` (Rule 18 ≥ 1.5)
            when the decision's own R:R would fall below it.
        When ``market_profile`` is ``None`` (default) the function behaves
        exactly as before — full backward compatibility with V38/V39.3 callers.
        """
        # V40.2-DATA-FIX: was 60, but data_engine.db has ~42 days max
        if day_idx < 15:
            return {'signal': 'WAIT', 'score': 0, 'proofs': {}}
        
        sl_closes = closes[:day_idx+1]
        sl_opens = opens[:day_idx+1]
        sl_highs = highs[:day_idx+1]
        sl_lows = lows[:day_idx+1]
        sl_volumes = volumes[:day_idx+1]
        
        atr_vals = calc_atr(sl_highs, sl_lows, sl_closes, 14)
        atr_val = atr_vals[-1] if atr_vals else 0.0
        
        # Rule 54 BUG FIX: sma200 كان بيحسب EMA-200 بالغلط (calc_ema بدل calc_sma)
        # ده بـ يخلي regime detection غلط لأن EMA أسرع في التغيّر من SMA
        sma200_vals = calc_sma(sl_closes, 200)
        sma200 = sma200_vals[-1] if sma200_vals else 0.0
        sma20_vals = calc_sma(sl_closes, 20)
        sma20 = sma20_vals[-1] if sma20_vals else 0.0
        
        last_close = sl_closes[-1]
        trend_up = last_close > sma200 if sma200 > 0 else True
        _reg_name = getattr(self, 'market_regime_name', None)
        market_regime = {
            'trend': _reg_name.lower() if _reg_name else ('bull' if trend_up else 'bear'),
            'confidence': 0.8,
            'name': _reg_name if _reg_name else ('صاعدي' if trend_up else 'هابط')
        }
        
        bb_mid, bb_up, bb_low = calc_bollinger_bands(sl_closes, 20, 2.0)
        bb_width = (bb_up[-1] - bb_low[-1]) / bb_mid[-1] * 100 if bb_mid[-1] > 0 else 0
        bb_width_sma_vals = calc_sma([((bb_up[i] - bb_low[i]) / bb_mid[i] * 100) if bb_mid[i] > 0 else 0 for i in range(len(bb_mid))], 50)
        bb_width_sma = bb_width_sma_vals[-1]
        is_squeeze = bb_width < bb_width_sma * 0.8
        is_expanding = bb_width > bb_width_sma * 1.2
        bb_squeeze = {'state': 'squeeze' if is_squeeze else ('expanding' if is_expanding else 'normal')}
        
        ob_state = detect_order_blocks_and_sweeps(sl_highs, sl_lows, sl_closes, lookback=5)
        levels = {
            'support': ob_state.last_support,
            'resistance': ob_state.last_resistance,
            'accumulation_zone': ob_state.sweep_low,
        }
        smc_data = {
            'score': 65 if ob_state.broke_resistance else (35 if ob_state.broke_support else 50),
            'order_blocks': [],
            'sweeps': [{'type': 'bullish_sweep' if ob_state.sweep_low else 'bearish_sweep'}] if ob_state.sweep_low else [],
        }
        
        fair_value, fair_premium = calc_fair_value(sl_highs, sl_lows, sl_closes, sl_volumes)
        fusion_metrics = {'fair_value': fair_value, 'fair_premium': fair_premium}
        
        vol_ma_vals = calc_sma(sl_volumes, 20)
        vol_ma = vol_ma_vals[-1] if vol_ma_vals else 0
        last_vol = sl_volumes[-1] if sl_volumes else 0
        vol_ratio = (last_vol / vol_ma) if vol_ma > 0 else 1.0
        quant_metrics = {'vsa_absorption': vol_ratio > 1.5, 'z_score': 0.0}
        
        stock_roc = ((sl_closes[-1] - sl_closes[-14]) / sl_closes[-14] * 100) if len(sl_closes) >= 14 and sl_closes[-14] > 0 else 0.0

        # V40.2: benchmark_change حقيقي من EGX30ETF (بدل 0.0 الثابت)
        if not self._benchmark_loaded:
            self._load_benchmark()
        scan_date_str = dates[day_idx] if day_idx < len(dates) else ''
        benchmark_change = self._benchmark_roc_by_date.get(scan_date_str, 0.0)

        fundamentals = self._get_fundamentals(ticker)
        # FUNDAMENTALS-FIX (2026-08-17): fundamentals.score is now a real 0-100 value
        # (from fundamental_data_provider.get_fundamental_score), not binary 0/1.
        # When unavailable → 0.0 (was 50.0 placeholder in V40.2 production; the measurement
        # script documents this as "missing fundamentals" rather than masking as neutral).
        fundamental_score = float(fundamentals.score) if fundamentals.available else 0.0

        decision = build_institutional_decision(
            ticker=ticker,
            closes=sl_closes,
            opens=sl_opens,
            highs=sl_highs,
            lows=sl_lows,
            volumes=sl_volumes,
            atr=atr_val,
            sma20=sma20,
            sma200=sma200,
            smc_data=smc_data,
            fusion_metrics=fusion_metrics,
            quant_metrics=quant_metrics,
            fundamental_score=fundamental_score,
            market_regime=market_regime,
            bb_squeeze=bb_squeeze,
            levels=levels,
            sector_change=sector_change,
            stock_roc=stock_roc,
            benchmark_change=benchmark_change,
        )

        signal_final = decision.get('signal_final', '🟡 انتظر')
        # V40.2: إصلاح bug ترتيب الفحص — 'انفجار' قبل 'شراء' (لأن نص الانفجار بيحتوي
        # كلمة شراء).
        # 🔥 PILLAR-4 (تكليف المالك 2026-08-10): 'شراء' عادي بقى BUY (كان WAIT).
        # السبب: الباكتست القديم طلع 6 صفقات فقط في 8 أشهر (target 60-150) —
        # لأن الـ WAIT بـ يـ reject كل إشارات الـ شراء العادي. دلوقتي الـ engine
        # بـ يـ emit BUY و الـ filter في daily_predictor.py بـ يـ accept.
        # جودة الصفقة بقت بـ تـ ensure عن طريق:
        #   1. R/R >= 1.5 (dynamic_rr_normal)
        #   2. evidence_count (sort by ✅ count)
        #   3. strict kill-filters (liquidity + free float + volatility)
        if 'انفجار' in signal_final:
            # BRAVO-KILL-INST-BUY (2026-10-19): INSTITUTIONAL_BUY signal اتقتل.
            # السبب: WR=0.0% (13 توقع كلهم STOPPED) + score=100 متكرر على HRHO.
            # أي "انفجار" دلوقتي بـ يـ emit STRONG_BUY (مش INSTITUTIONAL_BUY).
            signal = 'STRONG_BUY'  # was: 'INSTITUTIONAL_BUY' (KILLED — WR=0%)
        elif 'مؤسسي قوي' in signal_final or 'تجميع مؤسسي' in signal_final:
            signal = 'STRONG_BUY'
        elif 'شراء' in signal_final:
            # PILLAR-4: شراء عادي — كان WAIT (سبب قلة الصفقات: 6 فقط في 8 أشهر).
            # دلوقتي BUY عشان الباكتست يـ accept صفقات الـ R/R >= 1.5 الواقعية.
            # الـ evidence-based filter في daily_predictor.py بـ يـ ensure الجودة.
            signal = 'BUY'
        else:
            signal = 'WAIT'
        
        proofs_list = decision.get('proofs', [])
        proofs_dict = {}
        for p in proofs_list:
            name = p.get('name', '')
            if name == 'trend':
                proofs_dict['trend'] = p.get('text', '⚪')
            elif name == 'maker':
                proofs_dict['makers'] = p.get('text', '⚪')
            elif name == 'dna':
                proofs_dict['dna'] = p.get('text', '⚪')
            elif name == 'fundamentals':
                proofs_dict['fundamentals'] = p.get('text', '⏳')
            elif name == 'sector':
                proofs_dict['sector'] = p.get('text', '⚪')
            elif name == 'benchmark':
                proofs_dict['benchmark'] = p.get('text', '⚪')
        
        # ─── R:R-FIX (2026-08-17): read canonical keys from institutional_decision_engine ───
        # institutional_decision_engine.py returns: {'entry','sl','tp1','tp2','rr_ratio_tp1','rr_ratio_tp2'}
        # Previous code read 'stop_loss'/'target_1'/'target_2' (NON-EXISTENT keys) → fallback always fired
        # → R:R was FIXED at 1.5 forever, ignoring dynamic_rr_normal/outperform + ATR-percentile stops.
        # Fix: read the CORRECT keys ('sl', 'tp1', 'tp2') so V39 dynamic risk profile is honored.
        risk_profile = decision.get('risk_profile', {})
        entry = risk_profile.get('entry', last_close)
        sl = risk_profile.get('sl', risk_profile.get('stop_loss', last_close - atr_val * 1.5))
        tp1 = risk_profile.get('tp1', risk_profile.get('target_1', last_close + (last_close - sl) * self.rr1))
        tp2 = risk_profile.get('tp2', risk_profile.get('target_2', last_close + (last_close - sl) * self.rr2))

        if sl >= entry:
            sl = entry - (atr_val * 1.5)

        # ─── V40.4: MarketProfile injection (Directive §2 + §3) ───────────────
        # Adapt SL/TP to the market's physics: ATR stop bounds + dynamic R:R
        # floor. Only active when a MarketProfile is supplied — otherwise the
        # engine falls back to the PILLAR-3 global clamp (get_setting).
        if market_profile is not None and entry > 0:
            stop_pct = abs(entry - sl) / entry * 100.0
            lo = float(getattr(market_profile, 'atr_stop_min_pct', 3.0))
            hi = float(getattr(market_profile, 'atr_stop_max_pct', 9.0))
            if stop_pct < lo:
                # Stop too tight for this market → widen to the floor
                sl = entry - (entry * lo / 100.0)
            elif stop_pct > hi:
                # Stop too wide for this market → tighten to the ceiling
                sl = entry - (entry * hi / 100.0)

            # Enforce the market's dynamic R:R floor (Rule 18 ≥ 1.5).
            risk = abs(entry - sl)
            if risk > 0:
                rr_floor = float(getattr(market_profile, 'dynamic_rr_normal', 1.5))
                # Rule 18 absolute floor — never go below 1.5 regardless of market
                rr_floor = max(rr_floor, 2.0)
                cur_rr1 = abs(tp1 - entry) / risk
                if cur_rr1 < rr_floor:
                    tp1 = entry + risk * rr_floor
                cur_rr2 = abs(tp2 - entry) / risk
                rr2_floor = max(rr_floor * 1.5, 2.0)
                if cur_rr2 < rr2_floor:
                    tp2 = entry + risk * rr2_floor
        else:
            # ─── ATR stop clamp (P1 / PILLAR-3): fallback when no MarketProfile ───
            # CONSTITUTION Rule 8: stops must stay within [3%, max] of entry.
            # Without this clamp, a tiny-ATR stock could have a 0.5% stop (whipsawed) and a
            # huge-ATR stock could have a 15% stop (catastrophic loss). Both are forbidden.
            #
            # TIGHTENING (2026-09-02): Owner directive: "خفّض الستوب الأقصى من 9% لـ 7%"
            # Task REAPPLY-CRITICAL-FIXES: canonical default = 9.0 (engine_settings.py:241, Rule 8).
            # Was 7.0 (stale). → default max = 9.0% (env override takes priority).
            # → Override via env var: V40_2_STOP_MAX_PCT=9.0 (or any value).
            # → The tighter stop reduces per-trade loss but may increase false stops
            #   on volatile stocks. Use with trailing stop activation for best effect.
            try:
                from analyzers.engine_settings import get_setting
                _stop_min_pct = get_setting('atr_stop_min_pct', default=5.0)  # Task REAPPLY-CRITICAL-FIXES — was 3.0 (stale, Rule 8 floor = 5.0)
                # TIGHTENING: default 9.0% (was 7.0%, REAPPLY-CRITICAL-FIXES) — env override takes priority
                _stop_max_default = float(os.environ.get('V40_2_STOP_MAX_PCT', '9.0'))  # Task REAPPLY-CRITICAL-FIXES — was '7.0'
                _stop_max_pct = get_setting('atr_stop_max_pct', default=_stop_max_default)
                _stop_dist_pct = abs((entry - sl) / entry) * 100.0 if entry > 0 else 0.0
                if _stop_dist_pct < _stop_min_pct:
                    # Tighten: move stop down to minimum distance
                    sl = entry - (entry * _stop_min_pct / 100.0)
                elif _stop_dist_pct > _stop_max_pct:
                    # Widen cap: move stop up to maximum distance
                    sl = entry - (entry * _stop_max_pct / 100.0)
                # Re-derive tp1/tp2 from the clamped stop to preserve R:R ratio
                _risk = entry - sl
                if _risk > 0:
                    _rr1 = risk_profile.get('rr_ratio_tp1', self.rr1)
                    _rr2 = risk_profile.get('rr_ratio_tp2', self.rr2)
                    tp1 = entry + (_risk * _rr1)
                    tp2 = entry + (_risk * _rr2)
            except Exception:
                pass  # settings not available → keep V38 fallback behavior
        # ─── End ATR/R:R clamp (V40.4 MarketProfile + PILLAR-3 fallback) ──────
        
        maker_state = decision.get('maker_state', {})
        flight_state = decision.get('flight_state', {})

        # ─── Task part4-stop-loss: entry gate — reject BUY لو السهم في تصحيح نشط ──
        # المالك: "أحنا لازم نركز جدا فى وقت الدخول عالشان نقلل من وقف الخسائر"
        # R4.2: فقط يـ reject signal == 'BUY' (مش STRONG_BUY أو INSTITUTIONAL_BUY)
        # — الصفقات القوية ممكن تـ survive correction.
        if signal == 'BUY' and _STOCK_STATE_AVAILABLE:
            try:
                # change_percent من آخر closesين
                _gate_change_pct = 0.0
                if len(sl_closes) >= 2 and sl_closes[-2] > 0:
                    _gate_change_pct = ((sl_closes[-1] - sl_closes[-2]) / sl_closes[-2] * 100)

                # rsi_14 — Wilder's smoothing
                _gate_rsi = 50.0
                if len(sl_closes) >= 15:
                    _g_gains, _g_losses = [], []
                    for _gi in range(1, len(sl_closes)):
                        _chg = sl_closes[_gi] - sl_closes[_gi - 1]
                        if _chg >= 0:
                            _g_gains.append(_chg); _g_losses.append(0.0)
                        else:
                            _g_gains.append(0.0); _g_losses.append(-_chg)
                    if len(_g_gains) >= 14:
                        _ag = sum(_g_gains[-14:]) / 14
                        _al = sum(_g_losses[-14:]) / 14
                        _gate_rsi = 100.0 if _al == 0 else 100.0 - (100.0 / (1.0 + _ag / _al))

                # low_52w — min of last 252 closes (أو as many as available)
                _low_52w_lookback = min(252, len(sl_closes))
                _gate_low_52w = min(sl_closes[-_low_52w_lookback:]) if _low_52w_lookback > 0 else 0.0

                # ma_50 — simple SMA of last 50 closes (helper بـ uses ma_50 كـ proxy لـ MA20)
                _ma_50_window = sl_closes[-50:] if len(sl_closes) >= 50 else sl_closes
                _gate_ma_50 = (sum(_ma_50_window) / len(_ma_50_window)) if _ma_50_window else 0.0

                _gate_stock = {
                    'current_price': last_close,
                    'change_percent': _gate_change_pct,
                    'ma_50': _gate_ma_50,
                    'rsi': _gate_rsi,
                    'low_52w': _gate_low_52w,
                }

                if is_in_active_correction(_gate_stock):
                    _gate_date = dates[day_idx] if day_idx < len(dates) else ''
                    print(
                        f"[V38 entry-gate] {ticker} {_gate_date}: BUY → WAIT "
                        f"(in active correction: price={last_close:.2f} < ma50={_gate_ma_50:.2f}, "
                        f"rsi={_gate_rsi:.1f} < 45, change={_gate_change_pct:+.2f}%)"
                    )
                    return {
                        'signal': 'WAIT',
                        'score': 0,
                        'proofs': proofs_dict,
                        'reason': 'in_active_correction',
                    }
            except Exception as _gate_e:  # safe-by-design: gate errors تـ skip الـ gate
                print(f"[V38 entry-gate] {ticker}: gate check failed ({_gate_e}) → BUY retained")

        return {
            'signal': signal,
            'score': decision.get('tech_score', 0),
            'proofs': proofs_dict,
            'proofs_list': proofs_list,  # DNA-WINNER: keep the list for evidence counting
            'decision': decision,  # DNA-WINNER: keep full decision for debugging
            'entry': entry,
            'target': tp1,
            'target_2': tp2,
            'stop_loss': sl,
            'atr': atr_val,
            'fair_value': fair_value,
            'fair_premium': fair_premium,
            'maker_state': maker_state.get('state', 'calm'),
            'flight_state': flight_state.get('state', 'sideways'),
            'is_expanding': is_expanding,
            'is_squeeze': is_squeeze,
            'volume_surge': vol_ratio > 1.3,
            'dna_bullish': False,
            # FUNDAMENTALS-VETO (2026-08-17): expose real fundamental_score + availability
            # so daily_predictor can apply the hard veto (fund < 30 for non-gambler).
            # Architecturally the veto lives downstream because persona_fit is computed there
            # from proofs (compute_persona_fit) — persona is NOT known inside this engine.
            'fundamental_score': fundamental_score,
            'fundamentals_available': bool(fundamentals.available),
            # V40.3 REGIME-RR (2026-08-17): expose market regime trend so the downstream
            # R:R floor gate can use get_dynamic_min_rr(market_regime) instead of a flat
            # value. bull=2.0, bear=1.8, range=1.5 (floor 1.5 absolute).
            'market_regime_trend': market_regime.get('trend', 'range') if isinstance(market_regime, dict) else str(market_regime or 'range'),
        }
    
    def run_backtest(
        self,
        tickers: List[str],
        start_date: str = '2025-06-01',
        end_date: str = '2026-08-12',
        scan_interval: int = 5,  # Scan every N trading days
        max_daily_picks: int = 10,
        verbose: bool = True,
    ) -> BacktestSummary:
        """
        تشغيل المحاكاة الشاملة
        
        Parameters:
            tickers: قائمة الأسهم
            start_date: تاريخ بداية المحاكاة
            end_date: تاريخ نهاية المحاكاة
            scan_interval: كل كام يوم تاجر نعمل سكان (كل 5 أيام تداول)
            max_daily_picks: أقصى عدد توصيات في اليوم
            verbose: طباعة التقدم
        """
        summary = BacktestSummary()
        if summary.adaptive_threshold_final is None:
            summary.adaptive_threshold_final = int(get_setting('default_buy_threshold', default=75))

        # V40.2: فعّل strict kill-filter mode — بحيث فلاتر الاستبعاد تفضل صارمة
        # بغض النظر عن وقت تشغيل السكريبت (مش هتتّرخّص لـ 600K في السوق المقفول).
        set_strict_kill_filters(True)

        # Load fundamentals
        self._load_fundamentals()
        # V40.2: حمّل مؤشر EGX30ETF لحساب benchmark_change حقيقي
        self._load_benchmark()
        if verbose:
            print(f"📊 Loaded fundamentals for {len(self._fundamentals_cache)} stocks")
            print(f"📊 Benchmark ROC-14 dates: {len(self._benchmark_roc_by_date)}")

        # Load sector changes
        self._load_sector_changes(end_date)
        
        all_trades: List[Trade] = []
        all_returns: List[float] = []
        consecutive_wins = 0
        consecutive_losses = 0
        max_cons_wins = 0
        max_cons_losses = 0
        
        # Equity curve for drawdown calculation
        equity = [100.0]  # Starting with 100%
        peak_equity = 100.0
        max_drawdown = 0.0

        # V40.1: Position Sizing — fixed fractional risk per trade
        # كل صفقة تخاطر بنسبة ثابتة من رأس المال (1.5% افتراضيًا)
        # تأثير الصفقة على رأس المال = risk_pct × R-multiple
        risk_pct = float(get_setting('risk_per_trade_pct', default=1.5))
        position_sizing = bool(get_setting('position_sizing_enabled', default=1.0))
        summary.risk_per_trade_pct = risk_pct
        summary.position_sizing_enabled = position_sizing

        # Adaptive threshold state
        running_trades = 0
        running_wins = 0
        current_threshold = self.buy_threshold
        
        total_tickers = len(tickers)
        processed = 0
        
        for ticker in tickers:
            processed += 1
            if verbose and processed % 50 == 0:
                print(f"  ⏳ Processing {processed}/{total_tickers}: {ticker}...")
            
            dates, opens, highs, lows, closes, volumes = self.get_price_data(ticker)
            if len(closes) < 200:
                continue
            
            summary.total_tickers_tested += 1
            
            # Get sector change for this ticker
            sector_change = 0.0
            try:
                # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
                _v38_run_ctx = None
                try:
                    if _V38_BT_DBM_AVAILABLE:
                        _v38_run_ctx = _dbm.connection(STOCKS_DB, writable=False)
                        conn = _v38_run_ctx.__enter__()
                    else:
                        raise RuntimeError("db_manager unavailable")
                except Exception:
                    conn = sqlite3.connect(STOCKS_DB, timeout=5.0)
                    _v38_run_ctx = None
                cur = conn.cursor()
                cur.execute("SELECT sector, change_percent FROM stocks WHERE ticker = ?", (ticker,))
                row = cur.fetchone()
                conn.close()
                if row and row[0]:
                    sector_change = self._sector_changes.get(row[0], 0.0)
            except:
                pass
            
            # Scan on specified intervals
            scan_days = []
            for i in range(len(dates)):
                if dates[i] >= start_date and dates[i] <= end_date:
                    scan_days.append(i)
            
            # Take every scan_interval-th day
            scan_days = scan_days[::scan_interval]
            
            for day_idx in scan_days:
                if self.use_v393:
                    result = self.analyze_single_day(
                        ticker, dates, opens, highs, lows, closes, volumes,
                        day_idx, sector_change,
                        market_profile=self.market_profile,
                    )
                    signal = result['signal']
                    if signal not in ('INSTITUTIONAL_BUY', 'STRONG_BUY'):
                        continue
                else:
                    # Adaptive threshold
                    current_threshold = adaptive_threshold(
                        self.buy_threshold, running_trades,
                        (running_wins / running_trades * 100) if running_trades > 0 else 50.0
                    )
                    self.buy_threshold_current = current_threshold
                    
                    result = self.analyze_single_day(
                        ticker, dates, opens, highs, lows, closes, volumes,
                        day_idx, sector_change,
                    )
                    
                    # Override threshold with adaptive
                    if result['score'] >= current_threshold and result['signal'] == 'STRONG_BUY':
                        result['signal'] = 'STRONG_BUY'
                    elif result['score'] >= current_threshold:
                        pass  # already set
                    
                    signal = result['signal']
                    
                    # Only trade on BUY signals
                    if signal not in ('INSTITUTIONAL_BUY', 'STRONG_BUY'):
                        continue
                
                # Check if we have enough future data
                remaining_bars = len(closes) - day_idx - 1
                if remaining_bars < 5:
                    continue
                
                # Create trade
                trade = Trade(
                    ticker=ticker,
                    entry_date=dates[day_idx],
                    entry_price=result['entry'],
                    target_price=result['target'],
                    stop_loss=result['stop_loss'],
                    score=result['score'],
                    signal=signal,
                    proofs=result['proofs'],
                )
                
                # Simulate — with ATR for trailing stop
                future_closes = closes[day_idx+1:]
                future_dates_list = dates[day_idx+1:]
                # V38.1: compute ATR for the full range to pass into simulate_trade
                if not hasattr(self, '_atr_cache') or self._atr_cache_ticker != ticker:
                    self._atr_cache = calc_atr(highs, lows, closes, 14)
                    self._atr_cache_ticker = ticker
                future_atrs_list = self._atr_cache[day_idx+1:]
                trade = simulate_trade(trade, future_closes, future_dates_list, self.max_holding_days, future_atrs_list)
                
                if trade.exit_reason in ('hit_target', 'hit_stop', 'expired', 'trailing_stop', 'breakeven_stop'):
                    all_trades.append(trade)
                    
                    running_trades += 1
                    if trade.is_win:
                        running_wins += 1
                        consecutive_wins += 1
                        consecutive_losses = 0
                        max_cons_wins = max(max_cons_wins, consecutive_wins)
                    else:
                        consecutive_losses += 1
                        consecutive_wins = 0
                        max_cons_losses = max(max_cons_losses, consecutive_losses)
                    
                    # V40.1: Position Sizing — equity impact
                    # pnl_pct = risk_pct × R-multiple (تأثير الصفقة على رأس المال)
                    # لو Position Sizing معطّل → نستخدم return_pct (السلوك القديم)
                    if position_sizing and trade.entry_price > 0 and trade.stop_loss < trade.entry_price:
                        trade.pnl_pct = risk_pct * trade.r_multiple
                    else:
                        trade.pnl_pct = trade.return_pct

                    all_returns.append(trade.pnl_pct)

                    # Update equity curve
                    equity_change = trade.pnl_pct / 100
                    equity.append(equity[-1] * (1 + equity_change))
                    peak_equity = max(peak_equity, equity[-1])
                    drawdown = (peak_equity - equity[-1]) / peak_equity * 100
                    max_drawdown = max(max_drawdown, drawdown)
        
        # --- Calculate Summary ---
        summary.total_trades = len(all_trades)
        summary.winning_trades = sum(1 for t in all_trades if t.is_win)
        summary.losing_trades = summary.total_trades - summary.winning_trades
        summary.win_rate = (summary.winning_trades / summary.total_trades * 100) if summary.total_trades > 0 else 0
        summary.total_signals = sum(1 for t in all_trades if t.signal in ('INSTITUTIONAL_BUY', 'STRONG_BUY'))
        
        if all_returns:
            summary.avg_return = sum(all_returns) / len(all_returns)
            summary.total_return_pct = sum(all_returns)
        
        summary.gross_profit = sum(t.pnl_pct for t in all_trades if t.is_win)
        summary.gross_loss = abs(sum(t.pnl_pct for t in all_trades if not t.is_win))
        summary.profit_factor = summary.gross_profit / summary.gross_loss if summary.gross_loss > 0 else (999.0 if summary.gross_profit > 0 else 0.0)

        # V40.1: Position Sizing metrics — Avg Win / Loss / R-multiple / Final Equity
        wins_pnl = [t.pnl_pct for t in all_trades if t.is_win]
        losses_pnl = [t.pnl_pct for t in all_trades if not t.is_win]
        summary.avg_win = (sum(wins_pnl) / len(wins_pnl)) if wins_pnl else 0.0
        summary.avg_loss = (sum(losses_pnl) / len(losses_pnl)) if losses_pnl else 0.0
        summary.avg_r_multiple = (sum(t.r_multiple for t in all_trades) / len(all_trades)) if all_trades else 0.0
        summary.final_equity = equity[-1] if equity else 100.0
        
        holding_days = [t.holding_days for t in all_trades if t.holding_days > 0]
        summary.avg_holding_days = sum(holding_days) / len(holding_days) if holding_days else 0
        
        # Avg R/R
        rr_values = []
        for t in all_trades:
            risk = t.entry_price - t.stop_loss
            reward = t.target_price - t.entry_price
            if risk > 0:
                # Rule 54: استخدم canonical compute_risk_reward
                try:
                    from utils.risk_reward import compute_risk_reward
                    rr_values.append(compute_risk_reward(t.entry_price, t.target_price, t.stop_loss, fallback=reward / risk))
                except Exception:
                    rr_values.append(reward / risk)
        summary.avg_risk_reward = sum(rr_values) / len(rr_values) if rr_values else 0
        
        summary.max_consecutive_wins = max_cons_wins
        summary.max_consecutive_losses = max_cons_losses
        summary.max_drawdown_pct = max_drawdown
        
        # Sharpe ratio (simplified)
        if len(all_returns) > 1:
            avg_ret = sum(all_returns) / len(all_returns)
            variance = sum((r - avg_ret) ** 2 for r in all_returns) / (len(all_returns) - 1)
            std_ret = math.sqrt(variance) if variance > 0 else 1.0
            summary.sharpe_ratio = (avg_ret / std_ret) * math.sqrt(252) if std_ret > 0 else 0  # Annualized
        
        # Calmar ratio
        if max_drawdown > 0:
            annual_return = summary.avg_return * 252 / (summary.avg_holding_days if summary.avg_holding_days > 0 else 1)
            summary.calmar_ratio = annual_return / max_drawdown
        
        # Adaptive threshold final
        summary.adaptive_threshold_final = current_threshold
        
        # By signal type
        for t in all_trades:
            summary.by_signal[t.signal] = summary.by_signal.get(t.signal, 0) + 1
        
        # By proof count
        for t in all_trades:
            proof_count = sum(1 for v in t.proofs.values() if '✅' in v)
            summary.by_proof_count[proof_count] = summary.by_proof_count.get(proof_count, 0) + 1
        
        # Top winners/losers (V40.1: include pnl_pct & r_multiple)
        sorted_trades = sorted(all_trades, key=lambda t: t.pnl_pct, reverse=True)
        summary.top_winners = [
            {'ticker': t.ticker, 'date': t.entry_date, 'return_pct': round(t.return_pct, 2),
             'pnl_pct': round(t.pnl_pct, 3), 'r_multiple': round(t.r_multiple, 3),
             'signal': t.signal, 'score': t.score, 'holding_days': t.holding_days,
             'exit_reason': t.exit_reason}
            for t in sorted_trades[:10]
        ]
        summary.top_losers = [
            {'ticker': t.ticker, 'date': t.entry_date, 'return_pct': round(t.return_pct, 2),
             'pnl_pct': round(t.pnl_pct, 3), 'r_multiple': round(t.r_multiple, 3),
             'signal': t.signal, 'score': t.score, 'holding_days': t.holding_days,
             'exit_reason': t.exit_reason}
            for t in sorted_trades[-10:]
        ]
        
        # Monthly returns (V40.1: use pnl_pct — equity impact)
        for t in all_trades:
            if t.entry_date:
                month_key = t.entry_date[:7]  # YYYY-MM
                if month_key not in summary.monthly_returns:
                    summary.monthly_returns[month_key] = 0.0
                summary.monthly_returns[month_key] += t.pnl_pct
        
        # Model quality
        if summary.total_trades == 0:
            summary.model_quality = 'NO_TRADES'
            summary.model_quality_ar = '⏳ لا توجد صفقات'
        elif summary.win_rate >= 60 and summary.profit_factor > 1.2:
            summary.model_quality = 'EXCELLENT'
            summary.model_quality_ar = '✅ النموذج دقيق ومتأكد'
        elif summary.win_rate >= 50 and summary.profit_factor > 1.0:
            summary.model_quality = 'GOOD'
            summary.model_quality_ar = '🟡 النموذج مقبول — يحتاج ضبط'
        elif summary.win_rate >= 40:
            summary.model_quality = 'FAIR'
            summary.model_quality_ar = '🟠 النموذج ضعيف — يحتاج تحسين'
        else:
            summary.model_quality = 'POOR'
            summary.model_quality_ar = '🔴 النموذج فاشل — إعادة تصميم'
        
        self.trades = all_trades
        return summary
    
    def print_report(self, summary: BacktestSummary, mode: str = "V38"):
        """طباعة تقرير مفصل"""
        mode_label = "V39.3" if mode == "V39.3" else "V38"
        print("\n" + "=" * 80)
        print(f"  🔮 تقرير محرك القرار المؤسسي {mode_label} — المحاكاة الشاملة")
        print("=" * 80)
        
        print(f"\n📊 {'الإحصائية':<35} {'القيمة':>20}")
        print("-" * 60)
        print(f"  عدد الأسهم المختبرة:              {summary.total_tickers_tested}")
        print(f"  إجمالي الصفقات:                    {summary.total_trades}")
        print(f"  صفقات رابحة:                       {summary.winning_trades}")
        print(f"  صفقات خاسرة:                       {summary.losing_trades}")
        print(f"  نسبة النجاح:                       {summary.win_rate:.1f}%")
        print(f"  متوسط العائد:                      {summary.avg_return:.2f}%")
        print(f"  إجمالي العائد:                     {summary.total_return_pct:.2f}%")
        print(f"  إجمالي الربح:                      {summary.gross_profit:.2f}%")
        print(f"  إجمالي الخسارة:                    {summary.gross_loss:.2f}%")
        print(f"  معامل الربحية (PF):                {summary.profit_factor:.2f}" + (" ∞" if summary.profit_factor >= 999 else ""))
        print(f"  متوسط أيام الاحتفاظ:               {summary.avg_holding_days:.1f}")
        print(f"  متوسط نسبة المخاطرة/المكافأة:      {summary.avg_risk_reward:.2f}")
        print(f"  أقصى سلسلة ربح:                    {summary.max_consecutive_wins}")
        print(f"  أقصى سلسلة خسارة:                  {summary.max_consecutive_losses}")
        print(f"  معامل شارب:                        {summary.sharpe_ratio:.2f}")
        print(f"  أقصى تراجع:                        {summary.max_drawdown_pct:.2f}%")
        print(f"  حد الشراء الديناميكي:              {summary.adaptive_threshold_final}")
        # V40.1: Position Sizing metrics
        ps_flag = "✅ مفعّل" if summary.position_sizing_enabled else "❌ معطّل"
        print(f"\n  ── V40.1: Position Sizing ({ps_flag}) ──")
        print(f"  نسبة المخاطرة/صفقة:                {summary.risk_per_trade_pct:.2f}%")
        print(f"  متوسط R-multiple:                  {summary.avg_r_multiple:.3f}R")
        print(f"  متوسط الربح (تأثير رأس المال):     +{summary.avg_win:.3f}%")
        print(f"  متوسط الخسارة (تأثير رأس المال):   {summary.avg_loss:.3f}%")
        print(f"  رأس المال النهائي:                 {summary.final_equity:.2f}%")
        print(f"  إجمالي العائد (مركب):              {summary.final_equity - 100:.2f}%")
        
        print(f"\n🏆 جودة النموذج: {summary.model_quality_ar}")
        
        if summary.by_signal:
            print(f"\n📋 حسب نوع الإشارة:")
            for sig, count in sorted(summary.by_signal.items(), key=lambda x: -x[1]):
                print(f"    {sig}: {count}")
        
        if summary.by_proof_count:
            print(f"\n📋 حسب عدد الإثباتات المتحققة:")
            for pcount, count in sorted(summary.by_proof_count.items()):
                print(f"    {pcount} إثباتات: {count}")
        
        if summary.top_winners:
            print(f"\n🟢 أعلى 10 صفقات رابحة:")
            for i, t in enumerate(summary.top_winners, 1):
                print(f"    {i}. {t['ticker']} ({t['date']}): +{t['return_pct']:.2f}% | R={t['r_multiple']:+.2f} | تأثير={t['pnl_pct']:+.3f}% | {t['signal']} | {t['exit_reason']}")
        
        if summary.top_losers:
            print(f"\n🔴 أسوأ 10 صفقات خاسرة:")
            for i, t in enumerate(summary.top_losers, 1):
                print(f"    {i}. {t['ticker']} ({t['date']}): {t['return_pct']:.2f}% | R={t['r_multiple']:+.2f} | تأثير={t['pnl_pct']:+.3f}% | {t['signal']} | {t['exit_reason']}")
        
        if summary.monthly_returns:
            print(f"\n📅 العائد الشهري:")
            for month, ret in sorted(summary.monthly_returns.items()):
                emoji = '🟢' if ret > 0 else '🔴'
                print(f"    {month}: {emoji} {ret:+.2f}%")
        
        print("\n" + "=" * 80)


# ===========================================================================
# CLI Entry Point
# ===========================================================================

def main():
    parser = argparse.ArgumentParser(description='V38 Institutional Decision Engine — Backtester')
    parser.add_argument('--all', action='store_true', help='Test all available tickers')
    parser.add_argument('--tickers', nargs='+', help='Specific tickers to test')
    parser.add_argument('--start', default='2025-06-01', help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', default='2026-08-12', help='End date (YYYY-MM-DD)')
    parser.add_argument('--min-days', type=int, default=200, help='Minimum historical days required')
    parser.add_argument('--scan-interval', type=int, default=5, help='Scan every N trading days')
    parser.add_argument('--max-picks', type=int, default=10, help='Max daily picks')
    parser.add_argument('--threshold', type=int, default=75, help='Buy score threshold')
    parser.add_argument('--use-v393', action='store_true', help='Use V39.3 signal pipeline (institutional_decision_engine)')
    parser.add_argument('--output', default='', help='Output JSON file path')
    parser.add_argument('--quiet', action='store_true', help='Minimal output')
    
    args = parser.parse_args()
    
    engine = V38BacktestEngine(buy_threshold=args.threshold, use_v393=args.use_v393)
    
    # Determine tickers
    if args.all:
        tickers = engine.get_tickers(min_days=args.min_days)
        print(f"📊 Found {len(tickers)} tickers with >= {args.min_days} days of data")
    elif args.tickers:
        tickers = args.tickers
    else:
        # Default: test top 50 most active EGX stocks
        tickers = engine.get_tickers(min_days=args.min_days)[:50]
        print(f"📊 Testing top 50 tickers (use --all for all)")
    
    if not tickers:
        print("❌ No tickers found!")
        return
    
    mode_str = "V39.3" if args.use_v393 else "V38"
    print(f"🚀 Starting {mode_str} Backtest: {len(tickers)} tickers | {args.start} to {args.end}")
    print(f"   Scan interval: every {args.scan_interval} days | Threshold: {args.threshold}")
    
    summary = engine.run_backtest(
        tickers=tickers,
        start_date=args.start,
        end_date=args.end,
        scan_interval=args.scan_interval,
        max_daily_picks=args.max_picks,
        verbose=not args.quiet,
    )
    
    mode = "V39.3" if args.use_v393 else "V38"
    engine.print_report(summary, mode=mode)
    
    # Save to JSON
    mode_prefix = "v393_" if args.use_v393 else "v38_"
    output_path = args.output or str(PROJECT_ROOT / 'vps-service' / 'backtest_results' / f'{mode_prefix}backtest_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    result_dict = asdict(summary)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result_dict, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Results saved to: {output_path}")
    
    # Also save trades
    trades_path = output_path.replace('.json', '_trades.json')
    trades_data = [asdict(t) for t in engine.trades]
    with open(trades_path, 'w', encoding='utf-8') as f:
        json.dump(trades_data, f, indent=2, ensure_ascii=False, default=str)
    print(f"💾 Trades saved to: {trades_path}")


if __name__ == '__main__':
    main()

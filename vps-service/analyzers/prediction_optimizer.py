#!/usr/bin/env python3
"""
Prediction Optimizer Engine — محرك تحسين التوقعات
====================================================
يعالج المشاكل الجذرية الخمس التي تمنع الوصول لـ 60%+ win rate:

1. Score Inversion → Mean-Reversion logic (اشترِ عند الهبوط، بِع عند الصعود)
2. Signal Overgeneration → Conviction filter (فقط إشارات عالية الثقة)
3. BUY worse than SELL → Entry timing fix (انتظر pullback)
4. Wide stops → ATR-based risk management (max -4%)
5. No regime filter → Regime gate (skip trades against trend)

المحرك الجديد:
- يحسب إشارة mean-reversion (RSI + Bollinger + S/R)
- يطبق conviction filter (confluence >= 3)
- يفعّل regime gate (bull → BUY only, bear → SELL only)
- يحسب ATR-based stops/targets
- يرجع signal فقط عند high conviction
"""

from __future__ import annotations

from typing import List, Tuple, Optional, Dict
from dataclasses import dataclass, field
import math
import os
import sqlite3
import json
import logging
import threading
from datetime import datetime, timezone, timedelta

# BRAVO UNIFY (Rule 67 + Rule 27): delegate Bollinger to canonical (no fabrication)
# BRAVO-SSOT Stage 4: also delegate ATR/MACD/ADX to canonical.
from analyzers.indicators.bollinger import calc_bollinger as _canonical_bollinger
from analyzers.indicators.atr import calc_atr as _canonical_atr
from analyzers.indicators.ma import macd as _canonical_macd
from analyzers.indicators.adx import calc_adx as _canonical_adx
from pathlib import Path
from contextlib import contextmanager

# Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
try:
    from core.db_manager import db_manager as _dbm
    _PRED_OPT_DBM_AVAILABLE = True
except Exception as _po_err:
    _PRED_OPT_DBM_AVAILABLE = False
    print(f"[prediction_optimizer] db_manager not available ({_po_err}) — falling back to raw sqlite3")


@contextmanager
def _open_db(db_path: str, writable: bool = False):
    """Rule 54 / Phase 3: استخدم db_manager.connection() مع fallback sqlite3.connect."""
    ctx = None
    conn = None
    try:
        if _PRED_OPT_DBM_AVAILABLE:
            ctx = _dbm.connection(db_path, writable=writable)
            conn = 
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

# Import fundamental data provider
from analyzers.fundamental_data_provider import FundamentalDataProvider
# P1.3/P1.4: REGIME_ATR_MULTIPLIERS و CONFLUENCE_MIN بقوا بـ يـ read من engine_settings
from analyzers.engine_settings import get_setting

# سجل الأحداث
_log = logging.getLogger(__name__)


@dataclass
class OptimizedSignal:
    """إشارة محسّنة — تخرج فقط عند high conviction."""
    signal: str  # 'BUY' / 'SELL' / 'HOLD'
    score: float  # 0-100 (conviction score)
    entry: float
    target: float
    stop: float
    risk_reward: float
    conviction_factors: List[str]  # قائمة العوامل التي اتفقت
    regime: str  # 'bull' / 'bear' / 'range' / 'unknown'
    skip_reason: Optional[str] = None  # سبب التجاوز إن وجد


# Regime-specific ATR multipliers — P1.3: بـ read من engine_settings (regime_atr_stop_<regime>
# و regime_atr_target_<regime>). الـ dict القديم بقى shim بـ build ديناميكي من الـ settings.
# — في السوق الصاعد: وقف أوسع + هدف أكبر (نتبع الاتجاه)
# — في السوق العرضي: وقف ضيق + هدف صغير (لا اتجاه واضح)
# — في السوق الهابط: وقف جداً ضيق (حماية رأس المال)
_REGIME_NAMES = ('strong_bull', 'weak_bull', 'bull', 'range', 'weak_bear', 'bear', 'strong_bear')


def _build_regime_atr_multipliers() -> dict:
    """Build REGIME_ATR_MULTIPLIERS dict from engine_settings flat keys.
    P1.3: migrated from hardcoded dict to settings-driven dict.
    Note: do NOT pass default= here — get_setting() falls back to
    DEFAULT_SETTINGS[key] when default=None (which is what we want)."""
    return {
        regime: {
            'stop':   get_setting(f'regime_atr_stop_{regime}'),
            'target': get_setting(f'regime_atr_target_{regime}'),
        }
        for regime in _REGIME_NAMES
    }


def get_atr_mults(regime: str) -> dict:
    """Get ATR stop/target multipliers based on market regime.
    — يرجع مضاعفات وقف الخسارة والهدف حسب حالة السوق"""
    multipliers = _build_regime_atr_multipliers()
    return multipliers.get(regime, multipliers['range'])


# Backward-compat: keep REGIME_ATR_MULTIPLIERS as a property-like dict
# built lazily on first access. الـ callers اللي بـ يعملوا `from prediction_optimizer
# import REGIME_ATR_MULTIPLIERS` هتـفضل شغّالة.
class _DeprecatedRegimeAtrMultipliers(dict):
    """P1.3: deprecated shim — بـ read من engine_settings ديناميكيًا."""

    def __init__(self):
        super().__init__()

    def _refresh(self):
        built = _build_regime_atr_multipliers()
        for k, v in built.items():
            super().__setitem__(k, v)

    def __getitem__(self, key):
        self._refresh()
        return super().__getitem__(key)

    def get(self, key, default=None):
        self._refresh()
        return super().get(key, default)

    def __contains__(self, key):
        self._refresh()
        return super().__contains__(key)

    def __iter__(self):
        self._refresh()
        return super().__iter__()

    def keys(self):
        self._refresh()
        return super().keys()

    def values(self):
        self._refresh()
        return super().values()

    def items(self):
        self._refresh()
        return super().items()


REGIME_ATR_MULTIPLIERS = _DeprecatedRegimeAtrMultipliers()


# Regime-specific confluence minimum — P1.4: بـ read من engine_settings (regime_confluence_min_<regime>).
# — في الصاعد: سمح بدخول بـ 1 عامل فقط (السوق مساعد)
# — في الهابط: محتاج 3 عوامل (محتاط)
# — في الهابط القوي: مستحيل 99 (لا صفقات)
def _build_confluence_min() -> dict:
    """Build CONFLUENCE_MIN dict from engine_settings flat keys.
    P1.4: migrated from hardcoded dict to settings-driven dict.
    Note: do NOT pass default= here — get_setting() falls back to
    DEFAULT_SETTINGS[key] when default=None (which is what we want)."""
    return {
        regime: get_setting(f'regime_confluence_min_{regime}')
        for regime in _REGIME_NAMES
    }


def get_confluence_min(regime: str) -> int:
    """Get minimum technical confluence count based on market regime.
    — يرجع الحد الأدنى لعدد العوامل التقنية المؤكدة حسب حالة السوق"""
    conf = _build_confluence_min()
    return conf.get(regime, conf['range'])


class _DeprecatedConfluenceMin(dict):
    """P1.4: deprecated shim — بـ read من engine_settings ديناميكيًا."""

    def __getitem__(self, key):
        return _build_confluence_min()[key]

    def get(self, key, default=None):
        return _build_confluence_min().get(key, default)

    def __contains__(self, key):
        return key in _build_confluence_min()

    def __iter__(self):
        return iter(_build_confluence_min())

    def keys(self):
        return _build_confluence_min().keys()

    def values(self):
        return _build_confluence_min().values()

    def items(self):
        return _build_confluence_min().items()


CONFLUENCE_MIN = _DeprecatedConfluenceMin()


class PredictionOptimizer:
    """محرك تحسين التوقعات — يعالج المشاكل الجذرية الخمس."""

    def __init__(self):
        # Load runtime params from config file (settable via admin UI)
        try:
            import sys
            from pathlib import Path
            sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
            from api.optimizer_params_routes import get_optimizer_params
            params = get_optimizer_params()
            self.min_conviction = params.get('min_conviction', 5)
            self.min_rr_ratio = params.get('min_rr_ratio', 1.8)
            self.max_stop_pct = params.get('max_stop_pct', 3.0)  # P1.2: PREDICTION-TIME filter (reject trades with stop > 3%). مختلف عن engine_settings.position_max_stop_pct=10.0 (POSITION-LAYER hard cap, الإنتاج) و عن risk_management_advanced:1487 max_stop_pct=15.0 (ATR-calc function default).
            self.min_target_pct = params.get('min_target_pct', 5.0)
            self.skip_bear_regime = params.get('skip_bear_regime', True)
            self.skip_bull_regime = params.get('skip_bull_regime', False)
            self.use_adx_filter = params.get('use_adx_filter', True)
            self.adx_threshold = params.get('adx_threshold', 20.0)
            self.max_holding_days = params.get('max_holding_days', 20)
        except Exception:
            # Fallback to defaults
            self.min_conviction = 5
            self.min_rr_ratio = 1.8
            self.max_stop_pct = 3.0  # P1.2: PREDICTION-TIME filter fallback — مفهوم مختلف عن position_max_stop_pct
            self.min_target_pct = 5.0
            self.skip_bear_regime = True
            self.skip_bull_regime = False
            self.use_adx_filter = True
            self.adx_threshold = 20.0
            self.max_holding_days = 20
        
        # Fundamental data provider (data_engine.db)
        self.fundamental_provider = FundamentalDataProvider()

        # === إنشاء جدول سجل التحسين لو مش موجود (أول حاجة عشان الـ load يشتغل) ===
        self._db_root = Path(__file__).resolve().parent.parent.parent
        self._predictions_db = str(self._db_root / 'db' / 'predictions.db')
        self._ensure_optimizer_table()

        # === باراميترات التحسين المحسّنة (rolling window) ===
        self.optimized_params = self._load_optimized_params()

        # === باراميترات مخصصة حسب حالة السوق (regime-specific) ===
        self._regime_params = self.optimized_params.get('regime_specific', {})

    def _get_db_path(self) -> str:
        """يرجع مسار predictions.db."""
        return self._predictions_db

    def _ensure_optimizer_table(self):
        """ينشئ جدول سجل التحسين لو مش موجود."""
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _po_eot_ctx = None
            try:
                if _PRED_OPT_DBM_AVAILABLE:
                    _po_eot_ctx = _dbm.connection(self._get_db_path(), writable=True)
                    
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self._get_db_path())
                _po_eot_ctx = None
            conn.execute('''
                CREATE TABLE IF NOT EXISTS optimizer_params_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    optimized_at TEXT NOT NULL,
                    window_days INTEGER DEFAULT 90,
                    regime TEXT DEFAULT 'all',
                    total INTEGER DEFAULT 0,
                    win_rate REAL DEFAULT 0,
                    profit_factor REAL DEFAULT 0,
                    params_json TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            conn.commit()
            conn.close()
        except Exception as e:
            _log.warning('فشل إنشاء جدول optimizer_params_history: %s', e)

    def _load_optimized_params(self) -> Dict:
        """يحمل آخر باراميترات محسّنة من قاعدة البيانات."""
        defaults = {
            'best_min_conviction': 5,
            'best_min_rr': 1.5,
            'best_stop_atr_mult': 2.5,
            'best_target_atr_mult': 4.0,
            'window_days': 90,
            'total_predictions': 0,
            'win_rate': 0.0,
            'profit_factor': 0.0,
            'regime': 'all',
            'last_optimized': None,
            'regime_specific': {},
        }
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _po_lop_ctx = None
            try:
                if _PRED_OPT_DBM_AVAILABLE:
                    _po_lop_ctx = _dbm.connection(self._get_db_path(), writable=False)
                    
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self._get_db_path())
                _po_lop_ctx = None
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                'SELECT * FROM optimizer_params_history ORDER BY id DESC LIMIT 1'
            ).fetchone()
            conn.close()
            if row:
                params = json.loads(row['params_json']) if row['params_json'] else {}
                return {
                    'best_min_conviction': params.get('best_min_conviction', defaults['best_min_conviction']),
                    'best_min_rr': params.get('best_min_rr', defaults['best_min_rr']),
                    'best_stop_atr_mult': params.get('best_stop_atr_mult', defaults['best_stop_atr_mult']),
                    'best_target_atr_mult': params.get('best_target_atr_mult', defaults['best_target_atr_mult']),
                    'window_days': row['window_days'] or 90,
                    'total_predictions': row['total'] or 0,
                    'win_rate': row['win_rate'] or 0.0,
                    'profit_factor': row['profit_factor'] or 0.0,
                    'regime': row['regime'] or 'all',
                    'last_optimized': row['optimized_at'],
                    'regime_specific': params.get('regime_specific', {}),
                }
        except Exception as e:
            _log.warning('فشل تحميل باراميترات التحسين: %s', e)
        return defaults

    def analyze(
        self,
        prices: List[float],
        highs: List[float] = None,
        lows: List[float] = None,
        volumes: List[float] = None,
        ticker: str = None,
    ) -> OptimizedSignal:
        """
        تحليل شامل وإنتاج إشارة محسّنة.
        لا تخرج إشارة إلا عند high conviction.
        
        Args:
            ticker: رمز السهم (لجلب البيانات الأساسية من data_engine.db)
        """
        if len(prices) < 50:
            return OptimizedSignal(
                signal='HOLD', score=50, entry=prices[-1] if prices else 0,
                target=0, stop=0, risk_reward=0, conviction_factors=[],
                regime='unknown', skip_reason='insufficient_data'
            )

        current = prices[-1]
        highs = highs or prices
        lows = lows or prices
        volumes = volumes or []

        # 1. كشف الـ regime
        regime = self._detect_regime(prices)

        # === تشغيل التحسين المتدحرج في الخلفية لو لازم ===
        self._maybe_run_rolling_optimization()

        # === باراميترات R/R حسب الـ regime ===
        # bull: عتبة منخفضة (1.2) — السوق صاعد، سيب الرباح يكبر
        # bear: عتبة عالية (2.0) — السوق هابط، لازم ثقة عالية
        # range: عتبة متوسطة (1.5) — تداول عرضي
        regime_rr_thresholds = {'bull': 2.0, 'bear': 2.0, 'range': 1.5}
        effective_min_rr = regime_rr_thresholds.get(regime, self.min_rr_ratio)
        # لو فيه باراميترات محسّنة، نستخدمها
        if self.optimized_params and self.optimized_params.get('last_optimized'):
            effective_min_rr = self.optimized_params.get('best_min_rr', effective_min_rr)

        # ⚡ استخدام regime-specific parameters لو متاحة
        regime_p = {}
        if self._regime_params and regime in self._regime_params:
            regime_p = self._regime_params[regime]
            if regime_p.get('sample_size', 0) >= 5:  # بس لو عندنا بيانات كافية
                effective_min_rr = regime_p.get('min_rr', effective_min_rr)
                _log.debug("[Optimizer] Using regime-specific params for %s", regime)

        # 2. حساب المؤشرات
        rsi = self._calc_rsi(prices, 14)
        bb_upper, bb_middle, bb_lower, bb_pct = self._calc_bollinger(prices, 20)
        sma20 = sum(prices[-20:]) / 20
        sma50 = sum(prices[-50:]) / 50
        support, resistance = self._calc_support_resistance(prices, 20, ticker=ticker)
        atr = self._calc_atr(highs, lows, prices, 14)
        atr_pct = (atr / current * 100) if current > 0 else 3.0

        # 3. حساب العوامل (confluence factors) — حسب الـ regime
        buy_factors = []
        sell_factors = []

        if regime == 'range':
            # ===== Mean Reversion في Range =====
            # BUY: oversold conditions (price near support)
            if rsi < 35:
                buy_factors.append(f'RSI_oversold({rsi:.0f})')
            if bb_pct < 20:
                buy_factors.append(f'BB_lower({bb_pct:.0f}%)')
            if support > 0 and current > 0:
                dist_to_support = (current - support) / current * 100
                if dist_to_support < 3:
                    buy_factors.append(f'near_support({dist_to_support:.1f}%)')
            # SELL: overbought conditions (price near resistance)
            if rsi > 65:
                sell_factors.append(f'RSI_overbought({rsi:.0f})')
            if bb_pct > 80:
                sell_factors.append(f'BB_upper({bb_pct:.0f}%)')
            if resistance > 0 and current > 0:
                dist_to_resist = (resistance - current) / current * 100
                if dist_to_resist < 3:
                    sell_factors.append(f'near_resistance({dist_to_resist:.1f}%)')

        elif regime == 'bull':
            # ===== Trend Following في Bull =====
            # BUY: pullback to SMA20 in uptrend (don't chase, wait for dip)
            if current > sma50 and current < sma20:
                buy_factors.append(f'pullback_to_SMA20')
            if current > sma20 > sma50:
                buy_factors.append('uptrend_confirmed')
            if rsi > 40 and rsi < 60:
                buy_factors.append(f'RSI_neutral({rsi:.0f})')  # not overbought
            # SELL: overbought at resistance (take profit)
            if rsi > 75:
                sell_factors.append(f'RSI_overbought({rsi:.0f})')
            if bb_pct > 85:
                sell_factors.append(f'BB_upper({bb_pct:.0f}%)')

        elif regime == 'bear':
            # ===== Trend Following في Bear =====
            # SELL: rally to SMA20 in downtrend (sell into strength)
            if current < sma50 and current > sma20:
                sell_factors.append(f'rally_to_SMA20')
            if current < sma20 < sma50:
                sell_factors.append('downtrend_confirmed')
            if rsi > 40 and rsi < 60:
                sell_factors.append(f'RSI_neutral({rsi:.0f})')
            # BUY: oversold at support (counter-trend bounce)
            if rsi < 25:
                buy_factors.append(f'RSI_extreme_oversold({rsi:.0f})')
            if bb_pct < 10:
                buy_factors.append(f'BB_extreme_lower({bb_pct:.0f}%)')

        # Volume confirmation (في كل الحالات)
        if len(volumes) >= 20:
            avg_vol = sum(volumes[-20:]) / 20
            current_vol = volumes[-1] if volumes else 0
            if current_vol > avg_vol * 1.5:
                buy_factors.append('volume_spike')
                sell_factors.append('volume_spike')

        # MACD confirmation (في كل الحالات)
        macd_line, macd_signal, macd_hist = self._calc_macd(prices)
        if macd_hist > 0 and macd_line > macd_signal:
            buy_factors.append('MACD_bullish')
        elif macd_hist < 0 and macd_line < macd_signal:
            sell_factors.append('MACD_bearish')

        # Stochastic confirmation (في كل الحالات)
        stoch_k, stoch_d = self._calc_stochastic(highs, lows, prices)
        if stoch_k < 20 and stoch_k > stoch_d:
            buy_factors.append('Stoch_bullish_cross')
        elif stoch_k > 80 and stoch_k < stoch_d:
            sell_factors.append('Stoch_bearish_cross')

        # Price rejection (long lower wick = buying pressure)
        if len(highs) >= 3 and len(lows) >= 3:
            body = abs(prices[-1] - prices[-2])
            lower_wick = min(prices[-1], prices[-2]) - min(lows[-1], lows[-2])
            upper_wick = max(highs[-1], highs[-2]) - max(prices[-1], prices[-2])
            if lower_wick > body * 2:
                buy_factors.append('lower_wick_rejection')
            if upper_wick > body * 2:
                sell_factors.append('upper_wick_rejection')

        # ADX trend strength filter (only trade when market has direction)
        adx = self._calc_adx(highs, lows, prices)
        if adx > 20:
            buy_factors.append('ADX_trending')
            sell_factors.append('ADX_trending')

        # Capture technical factors count before adding fundamentals
        tech_buy_count = len(buy_factors)
        tech_sell_count = len(sell_factors)

        # ===== FUNDAMENTAL DATA FACTORS (from data_engine.db) =====
        # These add a completely new dimension: company quality + valuation
        if ticker:
            try:
                fd = self.fundamental_provider.get_fundamental_data(ticker)
                if fd.has_data:
                    # Valuation factors — cheap stocks get BUY bias
                    if fd.pe_ratio is not None and fd.pe_ratio > 0:
                        if fd.pe_ratio < 8:
                            buy_factors.append(f'PE_cheap({fd.pe_ratio:.1f})')
                        elif fd.pe_ratio > 30:
                            sell_factors.append(f'PE_expensive({fd.pe_ratio:.1f})')
                    
                    # Profitability — high ROE = quality company = BUY bias
                    if fd.roe is not None and fd.roe > 20:
                        buy_factors.append(f'ROE_high({fd.roe:.1f}%)')
                    elif fd.roe is not None and fd.roe < 5:
                        sell_factors.append(f'ROE_low({fd.roe:.1f}%)')
                    
                    # Dividend yield — high yield = BUY bias (income stock)
                    if fd.div_yield is not None and fd.div_yield > 5:
                        buy_factors.append(f'DivYield_high({fd.div_yield:.1f}%)')
                    
                    # Revenue growth — high growth = BUY bias
                    if fd.revenue_growth is not None and fd.revenue_growth > 15:
                        buy_factors.append(f'RevGrowth_high({fd.revenue_growth:.1f}%)')
                    elif fd.revenue_growth is not None and fd.revenue_growth < -10:
                        sell_factors.append(f'RevGrowth_neg({fd.revenue_growth:.1f}%)')
                    
                    # Net margin — profitable = BUY bias
                    if fd.net_margin is not None and fd.net_margin > 20:
                        buy_factors.append(f'NetMargin_high({fd.net_margin:.1f}%)')
                    elif fd.net_margin is not None and fd.net_margin < 0:
                        sell_factors.append(f'NetMargin_neg({fd.net_margin:.1f}%)')
                    
                    # Overall fundamental score (0-100)
                    if fd.overall_fundamental_score > 70:
                        buy_factors.append(f'FundScore_high({fd.overall_fundamental_score:.0f})')
                    elif fd.overall_fundamental_score < 40:
                        sell_factors.append(f'FundScore_low({fd.overall_fundamental_score:.0f})')
            except Exception as e:
                pass  # Fundamental data is optional, don't fail

        # ADX regime gate (Track 4 Optimized)
        # trending (bull/bear) requires strong trend: ADX > 25
        # rangebound requires no trend (ranging): ADX < 20
        if regime in ('bull', 'bear') and adx < 25:
            return OptimizedSignal(
                signal='HOLD', score=50, entry=current,
                target=0, stop=0, risk_reward=0,
                conviction_factors=[], regime=regime,
                skip_reason=f'weak_trend_for_trend_following_adx_({adx:.1f})'
            )
        if regime == 'range' and adx > 20:
            return OptimizedSignal(
                signal='HOLD', score=50, entry=current,
                target=0, stop=0, risk_reward=0,
                conviction_factors=[], regime=regime,
                skip_reason=f'strong_trend_for_mean_reversion_adx_({adx:.1f})'
            )

        # 4. Regime gate — معدّل (mean-reversion مسموح في كل الحالات)
        # Skip regimes based on runtime params (settable via admin UI)
        if self.skip_bear_regime and regime == 'bear':
            return OptimizedSignal(
                signal='HOLD', score=50, entry=current,
                target=0, stop=0, risk_reward=0,
                conviction_factors=[], regime=regime,
                skip_reason='skip_bear_regime (admin setting)'
            )
        if self.skip_bull_regime and regime == 'bull':
            return OptimizedSignal(
                signal='HOLD', score=50, entry=current,
                target=0, stop=0, risk_reward=0,
                conviction_factors=[], regime=regime,
                skip_reason='skip_bull_regime (admin setting)'
            )

        # في bull: SELL العادي ممنوع، لكن SELL overbought مسموح
        # في bear: BUY العادي ممنوع، لكن BUY oversold مسموح
        # هذا لأن mean-reversion يشتغل في كل الحالات
        mean_reversion_buy = any('oversold' in f or 'lower' in f.lower() or 'support' in f.lower() for f in buy_factors)
        mean_reversion_sell = any('overbought' in f or 'upper' in f.lower() or 'resistance' in f.lower() for f in sell_factors)

        if regime == 'bull' and sell_factors and not buy_factors and not mean_reversion_sell:
            return OptimizedSignal(
                signal='HOLD', score=50, entry=current,
                target=0, stop=0, risk_reward=0,
                conviction_factors=[], regime=regime,
                skip_reason='bearish_momentum_in_bull_market'
            )
        if regime == 'bear' and buy_factors and not sell_factors and not mean_reversion_buy:
            return OptimizedSignal(
                signal='HOLD', score=50, entry=current,
                target=0, stop=0, risk_reward=0,
                conviction_factors=[], regime=regime,
                skip_reason='bullish_momentum_in_bear_market'
            )

        # 5. Regime bonus/penalty للـ conviction
        buy_count = len(buy_factors)
        sell_count = len(sell_factors)
        regime_bonus = 0
        if regime == 'bull' and buy_count > sell_count:
            regime_bonus = 5  # BUY في bull = bonus
        elif regime == 'bear' and sell_count > buy_count:
            regime_bonus = 5  # SELL في bear = bonus
        # Range: no bonus — mean-reversion needs harder proof, not an easier pass

        # === ADAPTIVE THRESHOLDS (يوليو 2026 — مقترح كيمي) ===
        # النظام يعدّل الـ thresholds لوحده بناءً على أداء آخر 30 يوم
        effective_min_conviction = self.min_conviction
        if regime == 'range':
            # Range needs MORE confirmation (quality over quantity)
            # كيمي اقترح: conviction=6 (كان 5) + RSI_BUY=35 (كان 40)
            effective_min_conviction = max(self.min_conviction, 6)
        elif regime == 'bear':
            # Bear regime متذبذب (53.9% → 48.5%) — محتاج ADX gate أقوى
            effective_min_conviction = max(self.min_conviction, 7)

        # ⚡ regime-specific min_score override
        if regime_p.get('sample_size', 0) >= 5 and regime_p.get('min_score'):
            effective_min_conviction = regime_p['min_score'] / 10  # min_score 45→4.5→4, 60→6
            effective_min_conviction = max(4, min(8, int(effective_min_conviction)))
            _log.debug("[Optimizer] Regime-specific min_score for %s: %d", regime, effective_min_conviction)

        # === SECTOR-AWARE SCORING (يوليو 2026 — محسّن بتعديلات Z.ai) ===
        # بدل +3/-3 ثابت → multiplier 1.15x/0.85x (أقوى تأثير)
        sector_bonus = 0
        if ticker:
            try:
                sector_momentum = self._get_sector_momentum(ticker)
                if sector_momentum is not None:
                    if sector_momentum > 75:  # قطاع ساخن جداً
                        sector_bonus = 5
                        buy_factors.append(f'Sector momentum {sector_momentum:.0f} (+5 hot)')
                    elif sector_momentum > 60:  # قطاع طالع
                        sector_bonus = 3
                        buy_factors.append(f'Sector momentum {sector_momentum:.0f} (+3 warm)')
                    elif sector_momentum < 25:  # قطاع بارد جداً
                        sector_bonus = -5
                        sell_factors.append(f'Sector momentum {sector_momentum:.0f} (-5 cold)')
                    elif sector_momentum < 40:  # قطاع نازل
                        sector_bonus = -3
                        sell_factors.append(f'Sector momentum {sector_momentum:.0f} (-3 cool)')
            except Exception:
                pass

        # === DYNAMIC CONVICTION (يوليو 2026 — محسّن بتعديلات Z.ai) ===
        # بدل conviction ثابتة per regime → adaptive بناءً على recent WR
        # لو النظام كسبان (WR > 60%) → أسهل (conviction -1)
        # لو خسران (WR < 50%) → أصعب (conviction +1)
        # ملاحظة كيمي: cap بين 4 و 8 عشان نتجنب survivorship bias loop
        try:
            recent_wr = self._get_recent_win_rate(regime, days=30)
            if recent_wr is not None:
                if recent_wr > 60:
                    effective_min_conviction = max(4, effective_min_conviction - 1)  # أسهل
                elif recent_wr < 50:
                    effective_min_conviction = effective_min_conviction + 1  # أصعب
        except Exception:
            pass

        # Cap بين 4 و 8 (منع survivorship bias loop — مقترح كيمي)
        effective_min_conviction = max(4, min(8, effective_min_conviction))

        # 6. اختيار الإشارة بناءً على confluence

        if buy_count >= self.min_conviction and buy_count > sell_count:
            # Require regime-dependent technical factors to confirm entry (Technical Confluence Gate)
            # — الحد الأدنى للتأكيد التقني يتغير حسب حالة السوق
            required_confluence = get_confluence_min(regime)
            if tech_buy_count < required_confluence:
                return OptimizedSignal(
                    signal='HOLD', score=50, entry=current,
                    target=0, stop=0, risk_reward=0,
                    conviction_factors=buy_factors, regime=regime,
                    skip_reason=f'insufficient_technical_confluence({tech_buy_count}<{required_confluence},regime={regime})'
                )
            # BUY signal
            target, stop, rr = self._calc_target_stop(
                current, support, resistance, atr, atr_pct, 'BUY',
                regime=regime, prices=prices
            )
            if rr < effective_min_rr:
                return OptimizedSignal(
                    signal='HOLD', score=50, entry=current,
                    target=target, stop=stop, risk_reward=rr,
                    conviction_factors=buy_factors, regime=regime,
                    skip_reason=f'low_rr({rr:.1f}<{effective_min_rr})'
                )
            conviction_score = min(100, 50 + buy_count * 10 + regime_bonus)
            return OptimizedSignal(
                signal='BUY', score=conviction_score, entry=current,
                target=target, stop=stop, risk_reward=rr,
                conviction_factors=buy_factors, regime=regime
            )

        if sell_count >= self.min_conviction and sell_count > buy_count:
            # Require regime-dependent technical factors to confirm entry
            # — الحد الأدنى للتأكيد التقني يتغير حسب حالة السوق
            required_confluence = get_confluence_min(regime)
            if tech_sell_count < required_confluence:
                return OptimizedSignal(
                    signal='HOLD', score=50, entry=current,
                    target=0, stop=0, risk_reward=0,
                    conviction_factors=sell_factors, regime=regime,
                    skip_reason=f'insufficient_technical_confluence({tech_sell_count}<{required_confluence},regime={regime})'
                )
            # SELL signal
            target, stop, rr = self._calc_target_stop(
                current, support, resistance, atr, atr_pct, 'SELL',
                regime=regime, prices=prices
            )
            if rr < effective_min_rr:
                return OptimizedSignal(
                    signal='HOLD', score=50, entry=current,
                    target=target, stop=stop, risk_reward=rr,
                    conviction_factors=sell_factors, regime=regime,
                    skip_reason=f'low_rr({rr:.1f}<{effective_min_rr})'
                )
            conviction_score = min(100, 50 + sell_count * 10 + regime_bonus)
            return OptimizedSignal(
                signal='SELL', score=conviction_score, entry=current,
                target=target, stop=stop, risk_reward=rr,
                conviction_factors=sell_factors, regime=regime
            )

        # No high-conviction signal
        return OptimizedSignal(
            signal='HOLD', score=50, entry=current,
            target=0, stop=0, risk_reward=0,
            conviction_factors=buy_factors + sell_factors, regime=regime,
            skip_reason=f'low_conviction(buy={buy_count},sell={sell_count})'
        )

    # ===================================================================
    # === التحسين المتدحرج (Rolling Window Optimization) — 90 يوم ===
    # ===================================================================

    def _maybe_run_rolling_optimization(self):
        """يشغّل التحسين المتدحرج في الخلفية لو مرت 7 أيام أو أكتر."""
        try:
            last = self.optimized_params.get('last_optimized')
            need_run = False
            if not last:
                need_run = True
            else:
                try:
                    last_dt = datetime.fromisoformat(last)
                    if datetime.now(timezone.utc) - last_dt > timedelta(days=7):
                        need_run = True
                except (ValueError, TypeError):
                    need_run = True
            if need_run:
                # شغّل في thread منفصل عشان ما يوقفش التحليل
                t = threading.Thread(target=self._optimize_rolling_window, daemon=True)
                t.start()
        except Exception as e:
            _log.debug('خطأ في التحقق من التحسين المتدحرج: %s', e)

    def _optimize_rolling_window(self) -> Dict:
        """تحسين الباراميترات بناءً على آخر 90 يوم من التوقعات المغلقة.

        بيجيب التوقعات من predictions.db، بيعمل grid search بسيط
        على min_conviction و min_rr، ويختار أفضل profit_factor.
        """
        defaults = {
            'best_min_conviction': self.min_conviction,
            'best_min_rr': self.min_rr_ratio,
            'best_stop_atr_mult': 2.5,
            'best_target_atr_mult': 4.0,
            'window_days': 90,
            'total_predictions': 0,
            'win_rate': 0.0,
            'profit_factor': 0.0,
            'regime': 'all',
            'last_optimized': None,
        }
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _po_ro1_ctx = None
            try:
                if _PRED_OPT_DBM_AVAILABLE:
                    _po_ro1_ctx = _dbm.connection(self._get_db_path(), writable=False)
                    
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self._get_db_path())
                _po_ro1_ctx = None
            conn.row_factory = sqlite3.Row

            # جيب التوقعات المغلقة في آخر 90 يوم
            rows = conn.execute("""
                SELECT signal_type, actual_return, is_correct
                FROM predictions
                WHERE outcome_date IS NOT NULL
                  AND actual_return IS NOT NULL
                  AND outcome_date >= datetime('now', '-90 days')
            """).fetchall()
            conn.close()

            if not rows:
                _log.info('مفيش توقعات مغلقة في آخر 90 يوم — التحسين المتدحرج ما يشتغلش')
                return defaults

            # === Grid search على min_conviction و min_rr ===
            best_result = None
            best_pf = -1.0
            best_wr = 0.0

            conviction_grid = [3, 4, 5, 6]
            rr_grid = [1.2, 1.5, 1.8, 2.0]

            for min_conv in conviction_grid:
                for min_rr in rr_grid:
                    # فلترة وهمية: نحسب إيه كان يحمّل لو استخدمنا القيم دي
                    # نشترط أن master_score >= min_conv * 10 (تقريبي)
                    # لإن Conviction Score = 50 + count * 10
                    # يعني count >= min_conv ↔ score >= 50 + min_conv * 10
                    min_score = 50 + min_conv * 10

                    # فلترة حسب R/R: نشترط actual_return لو إيجابي >= min_rr %
                    filtered = []
                    for r in rows:
                        ret = r['actual_return'] or 0
                        # محاكاة: نفلتر حسب درجة الثقة التقريبية
                        # بما إن مفيش master_score محفوظ كـ conviction حقيقي،
                        # بنستخدم is_correct كـ proxy للجودة
                        score_proxy = 80 if r['is_correct'] else 40
                        if score_proxy >= min_score:
                            # فلترة R/R: لو الصفقة رابحة، لازم return >= min_rr%
                            if ret > 0 and ret < min_rr:
                                continue
                            filtered.append(r)

                    if len(filtered) < 5:
                        continue

                    wins = sum(1 for r in filtered if r['is_correct'])
                    losses = sum(1 for r in filtered if not r['is_correct'])
                    total = wins + losses
                    if total == 0:
                        continue

                    win_rate = wins / total
                    gross_profit = sum(
                        r['actual_return'] for r in filtered if r['actual_return'] and r['actual_return'] > 0
                    )
                    gross_loss = abs(sum(
                        r['actual_return'] for r in filtered if r['actual_return'] and r['actual_return'] < 0
                    ))
                    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 999.0

                    # الأفضل: أعلى profit_factor، ولو تعادل → أعلى win_rate
                    if (profit_factor > best_pf) or (profit_factor == best_pf and win_rate > best_wr):
                        best_pf = profit_factor
                        best_wr = win_rate
                        best_result = {
                            'best_min_conviction': min_conv,
                            'best_min_rr': min_rr,
                            'best_stop_atr_mult': 2.5,
                            'best_target_atr_mult': 4.0,
                            'window_days': 90,
                            'total_predictions': total,
                            'win_rate': round(win_rate, 4),
                            'profit_factor': round(profit_factor, 4),
                            'regime': 'all',
                            'last_optimized': datetime.now(timezone.utc).isoformat(),
                        }

            if best_result is None:
                return defaults

            # === حفظ النتيجة في قاعدة البيانات ===
            # ⚡ Regime-specific optimization — نضيفه للـ params
            regime_params = self._regime_specific_optimize(days=60)
            best_result['regime_specific'] = regime_params

            try:
                # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
                _po_ro2_ctx = None
                try:
                    if _PRED_OPT_DBM_AVAILABLE:
                        _po_ro2_ctx = _dbm.connection(self._get_db_path(), writable=True)
                        
                    else:
                        raise RuntimeError("db_manager unavailable")
                except Exception:
                    conn = sqlite3.connect(self._get_db_path())
                    _po_ro2_ctx = None
                conn.execute(
                    '''INSERT INTO optimizer_params_history
                       (optimized_at, window_days, regime, total, win_rate, profit_factor, params_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?)''',
                    (
                        best_result['last_optimized'],
                        best_result['window_days'],
                        best_result['regime'],
                        best_result['total_predictions'],
                        best_result['win_rate'],
                        best_result['profit_factor'],
                        json.dumps(best_result),
                    )
                )
                conn.commit()
                conn.close()
            except Exception as e:
                _log.warning('فشل حفظ نتيجة التحسين المتدحرج: %s', e)

            # تحديث الباراميترات المحملة في الذاكرة
            self.optimized_params = best_result
            # ⚡ تحديث regime-specific params في الذاكرة
            self._regime_params = regime_params
            _log.info(
                'التحسين المتدحرج اكتمل: conviction=%d, R/R=%.1f, WR=%.1f%%, PF=%.2f',
                best_result['best_min_conviction'],
                best_result['best_min_rr'],
                best_result['win_rate'] * 100,
                best_result['profit_factor'],
            )
            _log.info(
                '[RegimeOptimize] bull=%s bear=%s range=%s',
                regime_params.get('regime_count', {}).get('bull', 0),
                regime_params.get('regime_count', {}).get('bear', 0),
                regime_params.get('regime_count', {}).get('range', 0),
            )
            return best_result

        except Exception as e:
            _log.warning('خطأ في التحسين المتدحرج: %s', e)
            return defaults

    def _regime_specific_optimize(self, days: int = 60) -> dict:
        """
        تحسين مخصص حسب حالة السوق (regime-specific).
        
        بدل optimization واحد لكل التاريخ، بنفصل:
        - Bull parameters: من آخر 60 يوم في bull
        - Bear parameters: من آخر 60 يوم في bear
        - Range parameters: من آخر 60 يوم في range
        
        النتيجة: parameters متخصصة لكل وضع — مش "متوسط" يفضل في مكان ومش مكان.
        
        Returns:
            dict: {
                'bull': {param: value, ...},
                'bear': {param: value, ...},
                'range': {param: value, ...},
                'regime_count': {'bull': N, 'bear': N, 'range': N},
            }
        """
        import sqlite3
        from pathlib import Path

        _PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
        db_path = os.environ.get('PREDICTIONS_DB', str(_PROJECT_ROOT / 'db' / 'predictions.db'))

        result = {
            'bull': {},
            'bear': {},
            'range': {},
            'regime_count': {'bull': 0, 'bear': 0, 'range': 0, 'unknown': 0},
        }

        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _po_rso_ctx = None
            try:
                if _PRED_OPT_DBM_AVAILABLE:
                    conn = _dbm.get_connection(db_path, writable=False)
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(db_path)
                _po_rso_ctx = None
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            # جلب التوقعات المقفولة مع حالة السوق وقتها
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%d')

            # نحاول نجيب التوقعات مع الـ regime
            # لو مفيش regime column، نحسبه من البيانات
            try:
                cur.execute('''
                    SELECT p.*, m.regime
                    FROM predictions p
                    LEFT JOIN market_regime_log m ON DATE(p.created_at) = DATE(m.date)
                    WHERE p.status IN ('target_hit', 'stopped')
                    AND p.created_at >= ?
                    ORDER BY p.created_at DESC
                ''', (cutoff,))
                rows = cur.fetchall()
            except Exception:
                # مفيش جدول market_regime_log — نستخدم detect_regime من البيانات
                cur.execute('''
                    SELECT *
                    FROM predictions
                    WHERE status IN ('target_hit', 'stopped')
                    AND created_at >= ?
                    ORDER BY created_at DESC
                ''', (cutoff,))
                rows = cur.fetchall()

            conn.close()

            if not rows or len(rows) < 10:
                _log.info("[RegimeOptimize] مفيش بيانات كافية (%d توقعات)", len(rows) if rows else 0)
                return result

            # تجميع التوقعات حسب الـ regime
            regime_groups = {'bull': [], 'bear': [], 'range': []}

            for row in rows:
                row_dict = dict(row)
                regime = row_dict.get('regime', 'unknown')

                if regime == 'unknown':
                    # نحسب regime من البيانات
                    try:
                        from analyzers.adaptive_weights import detect_regime
                        entry = float(row_dict.get('entry_price', 0) or 0)
                        target = float(row_dict.get('target_price', 0) or 0)
                        if entry > 0 and target > 0:
                            # لو target > entry = صاعد = bull proxy
                            if target > entry * 1.05:
                                regime = 'bull'
                            elif target < entry * 0.95:
                                regime = 'bear'
                            else:
                                regime = 'range'
                    except Exception:
                        regime = 'unknown'

                if regime in regime_groups:
                    regime_groups[regime].append(row_dict)
                    result['regime_count'][regime] += 1
                else:
                    result['regime_count']['unknown'] += 1

            # تحسين كل regime بشكل مستقل
            for regime, group in regime_groups.items():
                if len(group) < 5:
                    _log.debug("[RegimeOptimize] %s: %d توقعات بس — مش كافي", regime, len(group))
                    continue

                # حساب win rate و avg return لكل regime
                hits = [r for r in group if r.get('status') == 'target_hit']
                stops = [r for r in group if r.get('status') == 'stopped']

                total = len(group)
                win_rate = len(hits) / total if total > 0 else 0

                avg_win = 0.0
                avg_loss = 0.0
                if hits:
                    avg_win = sum(
                        (float(r.get('target_price', 0) or 0) - float(r.get('entry_price', 0) or 0))
                        / float(r.get('entry_price', 1) or 1) * 100
                        for r in hits
                    ) / len(hits)
                if stops:
                    avg_loss = sum(
                        (float(r.get('stop_price', 0) or 0) - float(r.get('entry_price', 0) or 0))
                        / float(r.get('entry_price', 1) or 1) * 100
                        for r in stops
                    ) / len(stops)

                # Parameters المقترحة حسب الـ regime
                if regime == 'bull':
                    # في bull: نقدر نتحمل R/R أقل عشان نسبة النجاح أعلى
                    result['bull'] = {
                        'min_rr': round(max(1.0, (avg_win / abs(avg_loss)) * 0.8) if avg_loss != 0 else 1.2, 2),
                        'rsi_sell_threshold': 90,  # في bull، RSI 90 مش overbought
                        'stop_atr_mult': 2.5,  # وقف أوسع — bull بيذبذب
                        'min_score': 45,  # عتبة أقل — في bull فرص أكتر
                        'win_rate': round(win_rate, 3),
                        'avg_win': round(avg_win, 2),
                        'avg_loss': round(avg_loss, 2),
                        'sample_size': total,
                    }
                elif regime == 'bear':
                    # في bear: لازم R/R أعلى + عتبة أعلى — فرص قليل
                    result['bear'] = {
                        'min_rr': round(max(1.5, (avg_win / abs(avg_loss)) * 1.2) if avg_loss != 0 else 2.0, 2),
                        'rsi_sell_threshold': 65,  # في bear، RSI 65 = overbought
                        'stop_atr_mult': 1.5,  # وقف أضيق — bear خطير
                        'min_score': 60,  # عتبة أعلى — بس الناجح
                        'win_rate': round(win_rate, 3),
                        'avg_win': round(avg_win, 2),
                        'avg_loss': round(avg_loss, 2),
                        'sample_size': total,
                    }
                else:  # range
                    result['range'] = {
                        'min_rr': round(max(1.2, (avg_win / abs(avg_loss)) * 1.0) if avg_loss != 0 else 1.5, 2),
                        'rsi_sell_threshold': 78,
                        'stop_atr_mult': 2.0,
                        'min_score': 50,
                        'win_rate': round(win_rate, 3),
                        'avg_win': round(avg_win, 2),
                        'avg_loss': round(avg_loss, 2),
                        'sample_size': total,
                    }

            _log.info(
                "[RegimeOptimize] bull=%d bear=%d range=%d",
                result['regime_count']['bull'],
                result['regime_count']['bear'],
                result['regime_count']['range'],
            )

        except Exception as e:
            _log.error("[RegimeOptimize] خطأ: %s", e)

        return result

    def _detect_regime(self, prices: List[float]) -> str:
        """كشف حالة السوق: bull/bear/range."""
        if len(prices) < 50:
            return 'unknown'
        current = prices[-1]
        sma20 = sum(prices[-20:]) / 20
        sma50 = sum(prices[-50:]) / 50

        # كشف الاتجاه
        if current > sma50 and sma50 > sum(prices[-60:-10]) / 50:
            return 'bull'
        elif current < sma50 and sma50 < sum(prices[-60:-10]) / 50:
            return 'bear'
        else:
            return 'range'

    def _calc_rsi(self, prices: List[float], period: int = 14) -> float:
        """حساب RSI — Wilder's smoothing.

        CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67)
        Backward-compatible wrapper around analyzers.indicators.rsi.calc_rsi.
        قبل كده: كان SMA-based — غلط رياضيًا.
        """
        # CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing
        from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi
        val = _canonical_calc_rsi(prices, period)
        return val if val is not None else 50.0

    def _calc_bollinger(
        self, prices: List[float], period: int = 20, std_mult: float = 2.0
    ) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:
        """حساب Bollinger Bands + %B — BRAVO UNIFY: delegates to canonical.
        Rule 27 (NO-FAKE-DATA): returns (None, None, None, None) on insufficient data.
        """
        result = _canonical_bollinger(prices, period, std_mult)
        if result is None:
            return None, None, None, None
        return (result['upper'], result['middle'], result['lower'], result['percent_b'])

    def _calc_support_resistance(
        self, prices: List[float], lookback: int = 20, ticker: str = None
    ) -> Tuple[float, float]:
        """حساب الدعم والمقاومة — بيحاول يستخدم الحاسبة المتقدمة الأول."""
        # === أول حاجة: جرب الحاسبة المتقدمة لو فيه ticker ===
        if ticker:
            try:
                from analyzers.support_resistance_calculator import calculate_support_resistance
                sr = calculate_support_resistance(ticker, days=90)
                if sr and sr.get('support') and sr.get('resistance'):
                    support_val = float(sr['support'])
                    resistance_val = float(sr['resistance'])
                    _log.debug(
                        'S/R متقدمة لـ %s: support=%.2f, resistance=%.2f',
                        ticker, support_val, resistance_val,
                    )
                    return support_val, resistance_val
            except Exception as e:
                _log.debug(' fallback لـ min/max في S/R لـ %s: %s', ticker, e)

        # === Fallback: min/max بسيط (المنطق الأصلي) ===
        if len(prices) < lookback:
            lookback = len(prices)
        recent = prices[-lookback:]
        return min(recent), max(recent)

    def _calc_atr(
        self, highs: List[float], lows: List[float], closes: List[float], period: int = 14
    ) -> float:
        """حساب ATR — BRAVO-SSOT Stage 4: delegates to canonical
        analyzers.indicators.atr.calc_atr (Wilder's smoothing).
        Backward-compat: returns 0.0 on insufficient data (was 0.03 * closes[-1] fabrication).
        """
        result = _canonical_atr(highs, lows, closes, period)
        return result if result is not None else 0.0

    def _calc_ema(self, values: List[float], period: int) -> List[float]:
        """حساب EMA."""
        if not values:
            return []
        multiplier = 2 / (period + 1)
        ema = [values[0]]
        for i in range(1, len(values)):
            ema.append(values[i] * multiplier + ema[-1] * (1 - multiplier))
        return ema

    def _calc_macd(
        self, prices: List[float], fast: int = 12, slow: int = 26, signal: int = 9
    ) -> Tuple[float, float, float]:
        """حساب MACD (line, signal, histogram) — BRAVO-SSOT Stage 4: delegates to
        canonical analyzers.indicators.ma.macd.
        Backward-compat: returns (0, 0, 0) on insufficient data.
        """
        result = _canonical_macd(prices, fast, slow, signal)
        if result is None:
            return 0, 0, 0
        return (result['line'], result['signal'], result['histogram'])

    def _calc_stochastic(
        self, highs: List[float], lows: List[float], closes: List[float],
        k_period: int = 14, d_period: int = 3
    ) -> Tuple[float, float]:
        """حساب Stochastic (%K, %D)."""
        if len(closes) < k_period + d_period:
            return 50, 50
        ks = []
        for i in range(k_period, len(closes)):
            hh = max(highs[i-k_period:i])
            ll = min(lows[i-k_period:i])
            k = ((closes[i] - ll) / (hh - ll) * 100) if hh > ll else 50
            ks.append(k)
        d = sum(ks[-d_period:]) / d_period if len(ks) >= d_period else 50
        return ks[-1] if ks else 50, d

    def _calc_adx(
        self, highs: List[float], lows: List[float], closes: List[float], period: int = 14
    ) -> float:
        """حساب ADX — BRAVO-SSOT Stage 4: delegates to canonical
        analyzers.indicators.adx.calc_adx (Wilder's smoothing).
        Returns the ADX value (0.0 on insufficient data — backward-compat fallback).
        """
        result = _canonical_adx(highs, lows, closes, period)
        if result is None:
            return 0.0
        return result['adx']

    def _calc_target_stop(
        self, current: float, support: float, resistance: float,
        atr: float, atr_pct: float, signal: str, regime: str = 'range',
        prices: List[float] = None
    ) -> Tuple[float, float, float]:
        """
        حساب target/stop باستخدام ATR + S/R — مع مضاعفات ديناميكية حسب الـ regime.
        - Stop: S/R-based مع buffer، حد أقصى -8%
        - Target: S/R-based أو ATR × target_mult، حد أدنى +6%
        - R/R >= 2:1

        ملاحظة: mean-reversion يحتاج stops أوسع ليعمل.
        """
        # — جيب المضاعفات حسب حالة السوق (ديناميكي)
        mults = get_atr_mults(regime)
        stop_mult = mults['stop']
        target_mult = mults['target']

        # لو المضاعفات صفر (strong_bear = لا تداول)، استخدم القيم المحافظة
        if stop_mult <= 0:
            stop_mult = 0.5  # very tight fallback
        if target_mult <= 0:
            target_mult = 1.0  # very small target fallback

        if signal == 'BUY':
            # Stop: below support with 1% buffer (أوسع ليعطي مجال)
            sr_stop = support * 0.99 if support > 0 else current * 0.94
            # ATR stop: مضاعف ديناميكي حسب الـ regime (كان ثابت ×2.5)
            atr_stop = current - atr * stop_mult
            # استخدم الأبعد (أقل خسارة محتملة لكن يعطي مجال للارتداد)
            stop = min(sr_stop, atr_stop)
            # === ADAPTIVE STOP (تعديل Z.ai) ===
            # بدل max_stop_pct ثابت، استخدم ATR-based adaptive stop
            # (أغسطس 2026 — BUGFIX: `prices` كان مش معرّف في الـ scope ده،
            #  فالـ NameError كان بيبطل تحليل أي سهم BUY زي RREI. اتضاف كـ parameter.)
            adaptive_stop_pct = self._get_adaptive_stop(prices or [], self.max_stop_pct)
            max_stop_price = current * (1 - adaptive_stop_pct / 100)
            stop = max(stop, max_stop_price)

            # Target: at resistance أو ATR × target_mult (ديناميكي — كان ثابت ×4)
            atr_target = current + atr * target_mult
            sr_target = resistance * 0.99 if resistance > current else current * 1.10
            target = min(atr_target, sr_target)
            # حد أدنى للربح 6%
            min_target_price = current * (1 + self.min_target_pct / 100)
            target = max(target, min_target_price)

        else:  # SELL
            sr_stop = resistance * 1.01 if resistance > 0 else current * 1.06
            atr_stop = current + atr * stop_mult
            stop = max(sr_stop, atr_stop)
            max_stop_price = current * (1 + self.max_stop_pct / 100)
            stop = min(stop, max_stop_price)

            atr_target = current - atr * target_mult
            sr_target = support * 1.01 if support < current else current * 0.90
            target = max(atr_target, sr_target)
            min_target_price = current * (1 - self.min_target_pct / 100)
            target = min(target, min_target_price)

        risk = abs(current - stop)
        reward = abs(target - current)
        rr = reward / risk if risk > 0 else 0
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            rr = compute_risk_reward(current, target, stop, fallback=rr)
        except Exception:
            pass  # keep inline rr computed above

        return target, stop, rr

    def _get_sector_momentum(self, ticker: str) -> float:
        """يجيب momentum القطاع بتاع السهم (0-100).

        بيجيب متوسط change_percent لكل أسهم نفس القطاع.
        لو القطاع كله طالع → momentum عالي (ساخن).
        لو نازل → momentum منخفض (بارد).
        """
        try:
            import sqlite3
            from pathlib import Path
            _root = Path(__file__).resolve().parent.parent.parent

            # 1. جيب sector بتاع السهم من stocks.db
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _po_sm1_ctx = None
            try:
                if _PRED_OPT_DBM_AVAILABLE:
                    _po_sm1_ctx = _dbm.connection(str(_root / 'db' / 'stocks.db'), writable=False)
                    
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                s_conn = sqlite3.connect(str(_root / 'db' / 'stocks.db'))
                _po_sm1_ctx = None
            s_conn.row_factory = sqlite3.Row
            row = s_conn.execute(
                "SELECT sector FROM stocks WHERE ticker = ?", (ticker,)
            ).fetchone()
            s_conn.close()
            if not row or not row['sector']:
                return 50.0  # neutral

            sector = row['sector']

            # 2. جيب متوسط change_percent لكل أسهم نفس القطاع
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _po_sm2_ctx = None
            try:
                if _PRED_OPT_DBM_AVAILABLE:
                    _po_sm2_ctx = _dbm.connection(str(_root / 'db' / 'stocks.db'), writable=False)
                    
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                s_conn = sqlite3.connect(str(_root / 'db' / 'stocks.db'))
                _po_sm2_ctx = None
            s_conn.row_factory = sqlite3.Row
            result = s_conn.execute("""
                SELECT AVG(change_percent) as avg_change, COUNT(*) as cnt
                FROM stocks WHERE sector = ? AND change_percent IS NOT NULL
            """, (sector,)).fetchone()
            s_conn.close()

            if not result or not result['cnt'] or result['cnt'] == 0:
                return 50.0

            avg_change = float(result['avg_change'] or 0)
            # حوّل الـ change لمقياس 0-100 (0% = 50, +5% = 100, -5% = 0)
            momentum = 50.0 + (avg_change * 10)  # 1% change = 10 points
            return max(0, min(100, momentum))
        except Exception:
            return 50.0  # neutral لو فيه أي خطأ

    def _get_recent_win_rate(self, regime: str, days: int = 30) -> float:
        """يجيب Win Rate لتوقعات آخر N يوم لـ regime معيّن.

        بيجيب من predictions table التوقعات المغلقة في آخر N يوم.
        لو مفيش data كافية → بيرجّع None.
        """
        try:
            import sqlite3
            from pathlib import Path
            _root = Path(__file__).resolve().parent.parent.parent
            _db = str(_root / 'db' / 'predictions.db')

            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _po_rwr_ctx = None
            try:
                if _PRED_OPT_DBM_AVAILABLE:
                    conn = _dbm.get_connection(_db, writable=False)
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(_db)
                _po_rwr_ctx = None
            conn.row_factory = sqlite3.Row

            # جيب التوقعات المغلقة في آخر N يوم
            rows = conn.execute("""
                SELECT outcome, COUNT(*) as cnt
                FROM predictions
                WHERE outcome_date IS NOT NULL
                AND outcome_date >= datetime('now', ?)
                GROUP BY outcome
            """, (f'-{days} days',)).fetchall()
            conn.close()

            if not rows:
                return None

            wins = sum(r['cnt'] for r in rows if r['outcome'] == 'WIN')
            total = sum(r['cnt'] for r in rows)
            if total == 0:
                return None
            return round(wins / total * 100, 1)
        except Exception:
            return None

    def _get_adaptive_stop(self, prices: List[float], highs: List[float] = None,
                           lows: List[float] = None, base_stop: float = 2.5) -> float:
        """ATR-based adaptive stop (تعديل Z.ai + تصحيح كيمي).

        بدل stop ثابت 2.5%، نحسب True ATR ونعدّل:
        - لو ATR > 3% → stop أوسع (3%+) عشان نشيل وقف خسارة كاذب
        - لو ATR < 1.5% → stop أضيق (2%) عشان نحافظ على رأس المال
        - وسط → base_stop

        تصحيح كيمي: استخدم True Range (high/low/close) بدل |close[i] - close[i-1]|
        """
        try:
            if len(prices) < 15:
                return base_stop

            # محاولة استخدام calc_atr الحقيقي (True Range)
            try:
                from analyzers.core_scoring_engine import calc_atr
                if highs and lows and len(highs) >= 15 and len(lows) >= 15:
                    atr = calc_atr(highs, lows, prices, period=14)
                    current_price = prices[-1]
                    if current_price > 0 and atr > 0:
                        atr_pct = (atr / current_price) * 100
                        if atr_pct > 3.0:
                            return max(3.0, base_stop)
                        elif atr_pct < 1.5:
                            return min(base_stop, 2.0)
                        return base_stop
            except ImportError:
                pass

            # Fallback: simplified ATR (لو highs/lows مش متاحة)
            ranges = []
            for i in range(1, min(15, len(prices))):
                ranges.append(abs(prices[i] - prices[i-1]))

            if not ranges:
                return base_stop

            avg_range = sum(ranges) / len(ranges)
            current_price = prices[-1]
            if current_price <= 0:
                return base_stop

            atr_pct = (avg_range / current_price) * 100

            if atr_pct > 3.0:
                return max(3.0, base_stop)
            elif atr_pct < 1.5:
                return min(base_stop, 2.0)
            return base_stop
        except Exception:
            return base_stop

    # ===================================================================
    # === حالة التحسين (للـ Admin API) ===
    # ===================================================================

    def get_optimization_status(self) -> Dict:
        """يرجع حالة التحسين المتدحرج — مفيد للـ admin dashboard.

        بيجيب آخر سجل من optimizer_params_history ويرجع تفاصيله.
        """
        default_status = {
            'last_optimized': None,
            'total_predictions': 0,
            'win_rate': 0.0,
            'profit_factor': 0.0,
            'best_params': {},
        }
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _po_gos_ctx = None
            try:
                if _PRED_OPT_DBM_AVAILABLE:
                    _po_gos_ctx = _dbm.connection(self._get_db_path(), writable=False)
                    
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self._get_db_path())
                _po_gos_ctx = None
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                'SELECT * FROM optimizer_params_history ORDER BY id DESC LIMIT 1'
            ).fetchone()
            conn.close()
            if row:
                params = json.loads(row['params_json']) if row['params_json'] else {}
                return {
                    'last_optimized': row['optimized_at'],
                    'total_predictions': row['total'] or 0,
                    'win_rate': round(float(row['win_rate'] or 0), 4),
                    'profit_factor': round(float(row['profit_factor'] or 0), 4),
                    'best_params': {
                        'min_conviction': params.get('best_min_conviction'),
                        'min_rr': params.get('best_min_rr'),
                        'stop_atr_mult': params.get('best_stop_atr_mult'),
                        'target_atr_mult': params.get('best_target_atr_mult'),
                    },
                }
        except Exception as e:
            _log.warning('خطأ في جلب حالة التحسين: %s', e)
        return default_status

if __name__ == '__main__':
    """اختبار ذاتي."""
    print("=" * 60)
    print("اختبار Prediction Optimizer")
    print("=" * 60)

    engine = PredictionOptimizer()

    # Test 1: Oversold → BUY
    prices = [100 - i * 0.5 for i in range(100)]  # declining → oversold
    prices[-5:] = [50, 48, 47, 48, 49]  # bounce from support
    result = engine.analyze(prices)
    print(f"\n📊 Oversold test:")
    print(f"  Signal: {result.signal}")
    print(f"  Score: {result.score}")
    print(f"  Conviction: {result.conviction_factors}")
    print(f"  Regime: {result.regime}")
    print(f"  Entry: {result.entry:.2f}, Target: {result.target:.2f}, Stop: {result.stop:.2f}")
    print(f"  R/R: {result.risk_reward:.2f}")

    # Test 2: Overbought → SELL
    prices = [50 + i * 0.5 for i in range(100)]  # rising → overbought
    prices[-5:] = [100, 102, 103, 102, 101]  # reject from resistance
    result = engine.analyze(prices)
    print(f"\n📊 Overbought test:")
    print(f"  Signal: {result.signal}")
    print(f"  Score: {result.score}")
    print(f"  Conviction: {result.conviction_factors}")
    print(f"  Regime: {result.regime}")

    # Test 3: No conviction → HOLD
    prices = [100 + (i % 10 - 5) * 0.3 for i in range(100)]  # flat/range
    result = engine.analyze(prices)
    print(f"\n📊 No conviction test:")
    print(f"  Signal: {result.signal}")
    print(f"  Skip reason: {result.skip_reason}")

    print("\n✅ اختبارات نجحت")

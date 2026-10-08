#!/usr/bin/env python3
"""
hmm_market_regime.py — HMM Market Regime Detector (Hidden Markov Model)
========================================================================
Task IMPROVEMENT-09-2026-10-06 (Rule 71 — Quantitative Layer 2)

المصدر: Kalman Filter / HMM Market Regime Blueprint من المالك
الهدف: كشف "الحالة الخفية" للسوق (Accumulation, Markup, Distribution, Markdown)
       بناءً على التغير في التقلب (Volatility Shifts) مش بس السعر.

الفرق عن MarketRegimeEngine الموجود:
- الموجود: Linear (SMA50 + SMA200 + slope) — بطيء الاستجابة
- HMM: Non-linear — بيكشف التحولات الخفية قبل ما تظهر في السعر

المكتبة: hmmlearn (مثبتة بالفعل)
البيانات: price_history.db (EGX30ETF — 365 يوم)

CLI:
  python3 vps-service/analyzers/hmm_market_regime.py
"""
from __future__ import annotations

import sqlite3
import sys
import logging
import numpy as np
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

logger = logging.getLogger(__name__)

# Resolve DB path
_DEFAULT_DB = str(PROJECT_ROOT / "db" / "price_history.db")

# HMM States (Wyckoff-inspired)
# 0 = Accumulation (تجميع — هادئ، تقلب منخفض)
# 1 = Markup (صعود — تقلب متوسط، اتجاه صاعد)
# 2 = Distribution (توزيع — تقلب متوسط، قمة)
# 3 = Markdown (هبوط — تقلب عالي، اتجاه هابط)
HMM_STATES = {
    0: {'name': 'Accumulation', 'name_ar': '🟢 تجميع', 'trading_allowed': True, 'position_modifier': 1.0},
    1: {'name': 'Markup', 'name_ar': '🚀 صعود', 'trading_allowed': True, 'position_modifier': 1.2},
    2: {'name': 'Distribution', 'name_ar': '🔴 توزيع', 'trading_allowed': False, 'position_modifier': 0.3},
    3: {'name': 'Markdown', 'name_ar': '🔻 هبوط', 'trading_allowed': False, 'position_modifier': 0.0},
}


class HMMMarketRegime:
    """
    Hidden Markov Model Market Regime Detector.
    بيستخدم 3 features:
    1. Daily returns (% change)
    2. Volatility (rolling std of returns)
    3. Volume ratio (current vs avg)
    """

    def __init__(self, db_path: str = None, n_states: int = 4):
        self.db_path = db_path or _DEFAULT_DB
        self.n_states = n_states
        self.model = None
        self.is_trained = False

    def _load_index_data(self, ticker: str = 'EGX30ETF', lookback_days: int = 500) -> Tuple[np.ndarray, np.ndarray]:
        """تحميل بيانات المؤشر من price_history.db."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row

        rows = conn.execute('''
            SELECT date, close_price, volume
            FROM price_history
            WHERE ticker = ? AND close_price IS NOT NULL AND close_price > 0
            ORDER BY date DESC LIMIT ?
        ''', (ticker, lookback_days)).fetchall()
        conn.close()

        if len(rows) < 50:
            logger.warning(f"HMM: insufficient data for {ticker} ({len(rows)} rows)")
            return np.array([]), np.array([])

        # Reverse to chronological order
        rows = list(reversed(rows))
        closes = np.array([float(r['close_price']) for r in rows])
        volumes = np.array([float(r['volume'] or 0) for r in rows])
        dates = [r['date'] for r in rows]

        return closes, volumes, dates

    def _extract_features(self, closes: np.ndarray, volumes: np.ndarray) -> np.ndarray:
        """استخراج 3 features من بيانات الأسعار."""
        if len(closes) < 30:
            return np.array([])

        # 1) Daily returns
        returns = np.diff(closes) / closes[:-1]

        # 2) Rolling volatility (20-day std of returns)
        vol_window = 20
        volatility = np.array([
            np.std(returns[max(0, i - vol_window):i]) if i >= vol_window else np.std(returns[:i+1])
            for i in range(len(returns))
        ])

        # 3) Volume ratio (current / avg 20)
        vol_avg = np.array([
            np.mean(volumes[max(0, i - vol_window):i]) if i >= vol_window else np.mean(volumes[:i+1])
            for i in range(len(volumes))
        ])
        vol_ratio = volumes / np.maximum(vol_avg, 1)

        # Align lengths (returns and volatility are len(closes)-1)
        # volumes is len(closes), so take vol_ratio[1:] to match returns
        vol_ratio_aligned = vol_ratio[1:] if len(vol_ratio) > len(returns) else vol_ratio

        # Stack features
        features = np.column_stack([
            returns,
            volatility,
            vol_ratio_aligned[:len(returns)],
        ])

        # Replace NaN/Inf with 0
        features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)

        return features

    def train(self, ticker: str = 'EGX30ETF', lookback_days: int = 500) -> Dict[str, Any]:
        """تدريب HMM على بيانات المؤشر التاريخية."""
        try:
            from hmmlearn.hmm import GaussianHMM
        except ImportError:
            logger.error("hmmlearn not installed. Run: pip install hmmlearn")
            return {'success': False, 'error': 'hmmlearn not installed'}

        closes, volumes, dates = self._load_index_data(ticker, lookback_days)
        if len(closes) < 50:
            return {'success': False, 'error': f'insufficient data ({len(closes)} rows)'}

        features = self._extract_features(closes, volumes)
        if len(features) < 30:
            return {'success': False, 'error': 'insufficient features'}

        # Train HMM (diag covariance = أبسط + أنسب للبيانات المالية)
        self.model = GaussianHMM(
            n_components=self.n_states,
            covariance_type='diag',
            n_iter=100,
            random_state=42,
        )

        self.model.fit(features)
        self.is_trained = True

        # Predict states for all data
        states = self.model.predict(features)

        # Map states to regimes based on characteristics
        # Calculate mean return + mean volatility per state
        state_stats = {}
        for s in range(self.n_states):
            mask = states == s
            if mask.sum() > 0:
                state_stats[s] = {
                    'mean_return': float(np.mean(features[mask, 0])),
                    'mean_volatility': float(np.mean(features[mask, 1])),
                    'count': int(mask.sum()),
                }

        # Sort states by mean_return (ascending)
        # Lowest return = Markdown, Highest return = Markup
        sorted_states = sorted(state_stats.keys(), key=lambda s: state_stats[s]['mean_return'])

        # Map: 0=Markdown (worst), 1=Distribution, 2=Accumulation, 3=Markup (best)
        state_mapping = {}
        if len(sorted_states) == 4:
            state_mapping[sorted_states[0]] = 3  # Markdown
            state_mapping[sorted_states[1]] = 2  # Distribution
            state_mapping[sorted_states[2]] = 0  # Accumulation
            state_mapping[sorted_states[3]] = 1  # Markup
        elif len(sorted_states) == 3:
            state_mapping[sorted_states[0]] = 3  # Markdown
            state_mapping[sorted_states[1]] = 0  # Accumulation
            state_mapping[sorted_states[2]] = 1  # Markup
        else:
            # fallback: 2 states
            for i, s in enumerate(sorted_states):
                state_mapping[s] = i % 4

        self.state_mapping = state_mapping

        # Current state (last prediction)
        current_raw_state = states[-1]
        current_mapped_state = state_mapping.get(current_raw_state, 0)
        current_regime = HMM_STATES.get(current_mapped_state, HMM_STATES[0])

        result = {
            'success': True,
            'ticker': ticker,
            'data_points': len(features),
            'date_range': [dates[0], dates[-1]],
            'current_state': current_mapped_state,
            'current_regime': current_regime['name'],
            'current_regime_ar': current_regime['name_ar'],
            'trading_allowed': current_regime['trading_allowed'],
            'position_modifier': current_regime['position_modifier'],
            'state_stats': state_stats,
            'state_mapping': {str(k): v for k, v in state_mapping.items()},
        }

        logger.info(f"HMM trained: {len(features)} samples, current regime = {current_regime['name']}")
        return result

    def predict_current(self, ticker: str = 'EGX30ETF') -> Dict[str, Any]:
        """التوقع الحالي للـ regime."""
        if not self.is_trained:
            result = self.train(ticker)
            if not result.get('success'):
                return {
                    'regime': 'UNKNOWN',
                    'regime_ar': '⚪ غير معروف',
                    'trading_allowed': True,
                    'position_modifier': 1.0,
                    'error': result.get('error', 'training failed'),
                }

        # Get latest data
        closes, volumes, dates = self._load_index_data(ticker, 100)
        if len(closes) < 30:
            return {
                'regime': 'UNKNOWN',
                'regime_ar': '⚪ غير معروف',
                'trading_allowed': True,
                'position_modifier': 1.0,
            }

        features = self._extract_features(closes, volumes)
        if len(features) < 10:
            return {
                'regime': 'UNKNOWN',
                'regime_ar': '⚪ غير معروف',
                'trading_allowed': True,
                'position_modifier': 1.0,
            }

        # Predict
        raw_state = self.model.predict(features[-1:])[0]
        mapped_state = self.state_mapping.get(raw_state, 0)
        regime = HMM_STATES.get(mapped_state, HMM_STATES[0])

        return {
            'regime': regime['name'],
            'regime_ar': regime['name_ar'],
            'trading_allowed': regime['trading_allowed'],
            'position_modifier': regime['position_modifier'],
            'raw_state': int(raw_state),
            'mapped_state': int(mapped_state),
        }


# Singleton instance
_hmm_instance: Optional[HMMMarketRegime] = None


def get_hmm_regime(ticker: str = 'EGX30ETF', retrain: bool = False) -> Dict[str, Any]:
    """الحصول على حالة السوق الحالية عبر HMM (singleton pattern).

    Args:
        ticker: مؤشر السوق (default: EGX30ETF)
        retrain: إعادة التدريب لو True

    Returns:
        dict فيه: regime, regime_ar, trading_allowed, position_modifier
    """
    global _hmm_instance

    if _hmm_instance is None or retrain:
        _hmm_instance = HMMMarketRegime()
        result = _hmm_instance.train(ticker)
        if not result.get('success'):
            logger.warning(f"HMM training failed: {result.get('error')}")
            return {
                'regime': 'UNKNOWN',
                'regime_ar': '⚪ غير معروف',
                'trading_allowed': True,
                'position_modifier': 1.0,
                'error': result.get('error'),
            }

    return _hmm_instance.predict_current(ticker)


if __name__ == '__main__':
    print('═══ HMM Market Regime Detector ═══')
    print(f'Time: {datetime.now().isoformat()}')
    print()

    result = get_hmm_regime('EGX30ETF')

    print(f'Regime: {result["regime"]} ({result["regime_ar"]})')
    print(f'Trading allowed: {result["trading_allowed"]}')
    print(f'Position modifier: {result["position_modifier"]}')

    if 'error' in result:
        print(f'Error: {result["error"]}')

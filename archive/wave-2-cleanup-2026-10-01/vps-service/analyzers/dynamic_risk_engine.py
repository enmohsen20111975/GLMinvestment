"""
Dynamic Risk Engine — VOLATILITY-ADAPTIVE TARGET / STOP
========================================================
محرك المخاطر الديناميكي — بديل للنسب الثابتة في scoring_fix.py

المشكلة:
  scoring_fix.calculate_real_target_stop() بيستخدم نسب ثابتة:
    score >= 70 → target=20%, stop=7%
    score >= 58 → target=15%, stop=8%
    ...
  دي نسب ثابتة لكل الأسهم، فبتخسر لما السهم متذبذب أو beta عالي.

الحل:
  نحسب ATR + Volatility + Beta + Max Drawdown، ونعدّل النسب ديناميكياً:
  - لو ATR متاح → target = entry + ATR * target_mult, stop = entry - ATR * stop_mult
  - لو ATR مش متاح → fallback للنسب الثابتة بناءً على volatility
  - رمضان → stop أوسع (×1.15) وهدف أصغر (×0.85)
  - beta > 1.5 → نوسّع النطاق بـ min(beta, 2.0)
  - max_drawdown > 15% → stop أوسع بـ 20% (عشان noise)

القاعدة: دائماً نضمن R/R >= 1.5، وإلا is_valid_trade=False.

Author: دليل الاستثمار (Phase 8 — Dynamic Risk Engine)
"""

from __future__ import annotations

import math
import os
import sqlite3
from pathlib import Path
import statistics
from typing import Any, Dict, List, Optional, Tuple


# ============================================================================
# CONSTANTS — ATR multipliers by score band (replaces fixed %)
# ============================================================================

# target_mult / stop_mult pairs based on master_score.
# Higher score → larger target relative to ATR, tighter stop.
SCORE_BAND_MULTIPLIERS: List[Tuple[float, float, float]] = [
    # (min_score, target_mult, stop_mult)
    (70.0, 4.0, 1.5),
    (58.0, 3.0, 1.8),
    (48.0, 2.5, 2.0),
    (0.0,  2.0, 2.5),
]

# Default fixed percentages used when ATR unavailable (mirrors scoring_fix.py)
FIXED_FALLBACK: List[Tuple[float, float, float]] = [
    # (min_score, target_pct, stop_pct)
    (70.0, 0.20, 0.07),
    (58.0, 0.15, 0.08),
    (48.0, 0.12, 0.10),
    (0.0,  0.10, 0.12),
]

# Adjustments
RAMADAN_STOP_MULT = 1.15      # wider stops in low-liquidity
RAMADAN_TARGET_MULT = 0.85    # smaller targets
HIGH_BETA_THRESHOLD = 1.5
HIGH_BETA_CAP = 2.0
DRAWDOWN_THRESHOLD_PCT = 15.0
DRAWDOWN_STOP_INCREASE = 1.20  # +20% on stop mult
MIN_RISK_REWARD = 1.5


# ============================================================================
# HELPERS
# ============================================================================

def _safe_close_db(conn):
    try:
        conn.close()
    except Exception:
        pass


def _get_multipliers_for_score(score: float) -> Tuple[float, float]:
    """Return (target_mult, stop_mult) for the given score."""
    for min_score, t_mult, s_mult in SCORE_BAND_MULTIPLIERS:
        if score >= min_score:
            return t_mult, s_mult
    # Fallback (shouldn't reach)
    return 2.0, 2.5


def _get_fixed_pct_for_score(score: float) -> Tuple[float, float]:
    """Return (target_pct, stop_pct) for fallback path."""
    for min_score, t_pct, s_pct in FIXED_FALLBACK:
        if score >= min_score:
            return t_pct, s_pct
    return 0.10, 0.12


# ============================================================================
# MAIN ENGINE
# ============================================================================

class DynamicRiskEngine:
    """Dynamic Risk/Reward calculator.

    Computes ATR, historical volatility, beta vs EGX30, max drawdown,
    and produces adaptive target/stop prices.

    Usage:
        engine = DynamicRiskEngine('/path/to/stocks.db')
        result = engine.calculate_dynamic_target_stop(
            entry_price=100.0,
            prices=[...],
            highs=[...],
            lows=[...],
            score=62.0,
            support=95.0,
            resistance=115.0,
            ticker='COMI',
            sector='القطاع المالي',
            is_ramadan=False,
        )
    """

    def __init__(self, db_path: str):
        self.db_path = db_path

    # ----------------------------------------------------------------------
    # INDICATORS
    # ----------------------------------------------------------------------

    def compute_atr(self, prices: List[float], highs: List[float], lows: List[float], period: int = 14) -> float:
        """Average True Range (ATR).

        TR_t = max(high_t - low_t, |high_t - close_{t-1}|, |low_t - close_{t-1}|)
        ATR = SMA(TR, period)
        """
        try:
            n = min(len(prices), len(highs), len(lows))
            if n < period + 1 or period <= 0:
                return 0.0
            trs: List[float] = []
            for i in range(1, n):
                prev_close = prices[i - 1]
                if prev_close <= 0:
                    continue
                tr = max(
                    highs[i] - lows[i],
                    abs(highs[i] - prev_close),
                    abs(lows[i] - prev_close),
                )
                trs.append(tr)
            if not trs:
                return 0.0
            # Use last `period` TRs
            window = trs[-period:] if len(trs) >= period else trs
            return sum(window) / len(window)
        except Exception:
            return 0.0

    def compute_historical_volatility(self, prices: List[float], period: int = 20) -> float:
        """Standard deviation of log returns, annualized.

        Returns volatility as a percentage (e.g., 30.0 = 30% annualized).
        """
        try:
            if len(prices) < period + 1 or period <= 0:
                return 0.0
            # Use last `period+1` prices to compute `period` log returns
            window = prices[-(period + 1):]
            log_rets: List[float] = []
            for i in range(1, len(window)):
                if window[i - 1] <= 0 or window[i] <= 0:
                    continue
                log_rets.append(math.log(window[i] / window[i - 1]))
            if len(log_rets) < 5:
                return 0.0
            try:
                stdev = statistics.stdev(log_rets)
            except statistics.StatisticsError:
                return 0.0
            # Annualize: sqrt(252 trading days)
            return float(stdev * math.sqrt(252) * 100.0)
        except Exception:
            return 0.0

    def compute_beta_vs_market(self, ticker: str, prices: List[float], db_path: str = None) -> float:
        """Beta vs EGX30 index from market_indices or stock_price_history.

        Falls back to the `beta` column in `stocks` table.
        Returns 1.0 if no data is available.
        """
        try:
            db = db_path or self.db_path
            if not prices or len(prices) < 30:
                # Try the stocks table beta column
                return self._lookup_stock_beta(ticker, db)

            # Pull EGX30 daily changes from market_indices
            conn = sqlite3.connect(db)
            cur = conn.cursor()
            # market_indices table only has current snapshot — won't help with beta
            # Try stock_price_history table for index data first
            market_prices: List[float] = []
            try:
                cur.execute(
                    "SELECT close FROM stock_price_history WHERE ticker = 'EGX30' "
                    "ORDER BY date DESC LIMIT ?",
                    (len(prices),),
                )
                market_prices = [float(r[0]) for r in cur.fetchall() if r[0] and r[0] > 0]
                market_prices.reverse()
            except sqlite3.OperationalError:
                pass
            _safe_close_db(conn)

            if len(market_prices) >= len(prices):
                # Align lengths
                m = market_prices[-len(prices):]
                s = prices[-len(m):]
                return self._beta_from_prices(s, m)

            # Fallback: lookup stocks.beta
            return self._lookup_stock_beta(ticker, db)
        except Exception:
            try:
                return self._lookup_stock_beta(ticker, db_path or self.db_path)
            except Exception:
                return 1.0

    def _lookup_stock_beta(self, ticker: str, db_path: str) -> float:
        """Look up the beta column in stocks table; default 1.0."""
        try:
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute('SELECT beta FROM stocks WHERE ticker = ?', (ticker,))
            row = cur.fetchone()
            _safe_close_db(conn)
            if row and row[0] is not None:
                try:
                    b = float(row[0])
                    if 0.1 <= b <= 3.0:
                        return b
                except Exception:
                    pass
        except Exception:
            pass
        return 1.0

    def _beta_from_prices(self, stock: List[float], market: List[float]) -> float:
        """Compute beta from two aligned price series."""
        try:
            n = min(len(stock), len(market))
            if n < 5:
                return 1.0
            s = stock[-n:]
            m = market[-n:]
            s_rets = [(s[i] / s[i - 1] - 1.0) for i in range(1, len(s)) if s[i - 1] > 0]
            m_rets = [(m[i] / m[i - 1] - 1.0) for i in range(1, len(m)) if m[i - 1] > 0]
            k = min(len(s_rets), len(m_rets))
            if k < 5:
                return 1.0
            s_rets = s_rets[-k:]
            m_rets = m_rets[-k:]
            mean_m = sum(m_rets) / k
            mean_s = sum(s_rets) / k
            cov = sum((m_rets[i] - mean_m) * (s_rets[i] - mean_s) for i in range(k)) / k
            var_m = sum((m_rets[i] - mean_m) ** 2 for i in range(k)) / k
            if var_m <= 0:
                return 1.0
            beta = cov / var_m
            # Sanity clamp
            return max(-2.0, min(3.0, beta))
        except Exception:
            return 1.0

    def compute_max_drawdown(self, prices: List[float], window: int = 60) -> float:
        """Max drawdown over the last `window` days, as a percentage (positive number)."""
        try:
            if not prices or window <= 0:
                return 0.0
            recent = prices[-window:] if len(prices) >= window else prices
            if len(recent) < 2:
                return 0.0
            peak = recent[0]
            max_dd = 0.0
            for p in recent:
                if p > peak:
                    peak = p
                if peak > 0:
                    dd = (peak - p) / peak * 100.0
                    if dd > max_dd:
                        max_dd = dd
            return float(max_dd)
        except Exception:
            return 0.0

    def compute_sector_avg_volatility(self, sector: str, db_path: str = None) -> float:
        """Average 20-day volatility of all active stocks in the sector."""
        try:
            db = db_path or self.db_path
            conn = sqlite3.connect(db)
            cur = conn.cursor()
            cur.execute(
                "SELECT ticker FROM stocks WHERE sector = ? AND is_active = 1",
                (sector,),
            )
            tickers = [r[0] for r in cur.fetchall()]
            _safe_close_db(conn)
            if not tickers:
                return 0.0

            # Need price_history.db for actual prices
            db_dir = os.path.dirname(os.path.abspath(db))
            ph_path = os.path.join(db_dir, 'price_history.db')
            if not os.path.exists(ph_path):
                return 0.0

            vols: List[float] = []
            ph_conn = sqlite3.connect(f'file:{ph_path}?mode=ro', uri=True)
            ph_cur = ph_conn.cursor()
            for tk in tickers[:30]:  # cap to keep this fast
                try:
                    ph_cur.execute(
                        "SELECT close_price FROM price_history WHERE ticker = ? "
                        "ORDER BY date DESC LIMIT 25",
                        (tk,),
                    )
                    closes = [float(r[0]) for r in ph_cur.fetchall() if r[0] and r[0] > 0]
                    closes.reverse()
                    v = self.compute_historical_volatility(closes, period=20)
                    if v > 0:
                        vols.append(v)
                except Exception:
                    continue
            _safe_close_db(ph_conn)
            if not vols:
                return 0.0
            return float(sum(vols) / len(vols))
        except Exception:
            return 0.0

    # ----------------------------------------------------------------------
    # MAIN ENTRY — calculate_dynamic_target_stop
    # ----------------------------------------------------------------------

    def calculate_dynamic_target_stop(
        self,
        entry_price: float,
        prices: List[float],
        highs: List[float] = None,
        lows: List[float] = None,
        score: float = 50.0,
        support: Optional[float] = None,
        resistance: Optional[float] = None,
        ticker: Optional[str] = None,
        sector: Optional[str] = None,
        is_ramadan: bool = False,
    ) -> Dict[str, Any]:
        """Calculate target/stop dynamically.

        Returns same dict shape as scoring_fix.calculate_real_target_stop,
        plus new fields: atr_used, volatility_used, method.

        Priority:
          1) S/R primary (if support + resistance valid) — same as scoring_fix
          2) ATR-based (if ATR > 0) — dynamic multipliers by score
          3) Volatility fallback (mirror fixed-%, scaled by vol/3.0)
        """
        # Safety check
        if not entry_price or entry_price <= 0 or entry_price > 10000:
            return {
                'target_price': 0.0,
                'target_pct': 0.0,
                'stop_loss': 0.0,
                'stop_pct': 0.0,
                'risk_reward': 0.0,
                'entry_price': 0.0,
                'is_valid_trade': False,
                'rejection_reason': 'INVALID_ENTRY',
                'sr_used': False,
                'atr_used': 0.0,
                'volatility_used': 0.0,
                'method': 'INVALID',
            }

        highs = highs or []
        lows = lows or []

        # === Compute indicators ===
        atr = self.compute_atr(prices, highs, lows, period=14) if (prices and highs and lows) else 0.0
        volatility = self.compute_historical_volatility(prices, period=20) if prices else 0.0
        beta = self.compute_beta_vs_market(ticker, prices) if ticker else 1.0
        max_dd = self.compute_max_drawdown(prices, window=60) if prices else 0.0

        # === Determine multipliers (default by score band) ===
        target_mult, stop_mult = _get_multipliers_for_score(score)

        # === Apply contextual adjustments ===
        # Ramadan: wider stops, smaller targets (low liquidity → slower moves)
        if is_ramadan:
            stop_mult *= RAMADAN_STOP_MULT
            target_mult *= RAMADAN_TARGET_MULT

        # High-beta: wider ranges
        if beta > HIGH_BETA_THRESHOLD:
            beta_factor = min(beta, HIGH_BETA_CAP)
            target_mult *= beta_factor
            stop_mult *= beta_factor

        # Big drawdown: avoid noise stop-outs by widening stop
        if max_dd > DRAWDOWN_THRESHOLD_PCT:
            stop_mult *= DRAWDOWN_STOP_INCREASE

        # === Determine method ===
        has_valid_resistance = (resistance is not None
                                and resistance > entry_price
                                and resistance > 0)
        has_valid_support = (support is not None
                             and 0 < support < entry_price)

        method = 'VOLATILITY_FALLBACK'
        target_price = 0.0
        stop_loss = 0.0
        sr_used = False

        # Method 1: S/R primary
        if has_valid_resistance or has_valid_support:
            method = 'SR_PRIMARY'
            sr_used = True
            if has_valid_resistance:
                target_price = float(resistance)
            else:
                # No resistance — fall back to ATR or volatility for target
                if atr > 0:
                    target_price = entry_price + (atr * target_mult)
                else:
                    t_pct, _ = _get_fixed_pct_for_score(score)
                    target_price = entry_price * (1 + t_pct)
            if has_valid_support:
                stop_loss = float(support) * 0.99
            else:
                if atr > 0:
                    stop_loss = entry_price - (atr * stop_mult)
                else:
                    _, s_pct = _get_fixed_pct_for_score(score)
                    stop_loss = entry_price * (1 - s_pct)

        # Method 2: ATR-based
        elif atr > 0:
            method = 'ATR_BASED'
            target_price = entry_price + (atr * target_mult)
            stop_loss = entry_price - (atr * stop_mult)

        # Method 3: Volatility fallback (mirrors fixed-% logic, scaled by volatility)
        else:
            method = 'VOLATILITY_FALLBACK'
            t_pct, s_pct = _get_fixed_pct_for_score(score)
            # Scale: high-vol stocks get wider stops
            vol_scale = max(0.5, min(2.5, (volatility / 3.0) if volatility > 0 else 1.0))
            t_pct *= vol_scale
            s_pct *= vol_scale
            # Cap to avoid absurd values
            t_pct = min(t_pct, 0.40)
            s_pct = min(s_pct, 0.25)
            target_price = entry_price * (1 + t_pct)
            stop_loss = entry_price * (1 - s_pct)

        # Safety: ensure stop is below entry and target is above
        if stop_loss >= entry_price:
            _, s_pct = _get_fixed_pct_for_score(score)
            stop_loss = entry_price * (1 - s_pct)
        if target_price <= entry_price:
            t_pct, _ = _get_fixed_pct_for_score(score)
            target_price = entry_price * (1 + t_pct)

        # Recalculate percentages
        actual_target_pct = (target_price - entry_price) / entry_price
        actual_stop_pct = (entry_price - stop_loss) / entry_price

        # Risk-Reward
        risk = entry_price - stop_loss
        reward = target_price - entry_price
        risk_reward = reward / risk if risk > 0 else 0.0

        # Validity
        is_valid_trade = risk_reward >= MIN_RISK_REWARD
        rejection_reason = None if is_valid_trade else 'RR_BELOW_1_5'

        return {
            'target_price': round(target_price, 2),
            'target_pct': round(actual_target_pct * 100, 1),
            'stop_loss': round(stop_loss, 2),
            'stop_pct': round(actual_stop_pct * 100, 1),
            'risk_reward': round(risk_reward, 2),
            'entry_price': float(entry_price),
            'is_valid_trade': is_valid_trade,
            'rejection_reason': rejection_reason,
            'sr_used': sr_used,
            'atr_used': round(atr, 4),
            'volatility_used': round(volatility, 2),
            'beta_used': round(beta, 2),
            'max_drawdown_used': round(max_dd, 2),
            'method': method,
        }


# ============================================================================
# SMOKE TEST
# ============================================================================

if __name__ == '__main__':
    import random

    print('=' * 80)
    print('Dynamic Risk Engine — Smoke Test')
    print('=' * 80)

    db_path = str(Path(__file__).parent.parent.parent.resolve() / 'db' / 'stocks.db')
    if not os.path.exists(db_path):
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               '..', 'db', 'stocks.db')

    engine = DynamicRiskEngine(db_path)

    # Generate fake prices that look like a normal EGX stock
    random.seed(42)
    base = 100.0
    prices: List[float] = []
    highs: List[float] = []
    lows: List[float] = []
    for _ in range(100):
        change = random.gauss(0, 0.02)
        base = max(base * (1 + change), 1.0)
        prices.append(round(base, 2))
        highs.append(round(base * 1.015, 2))
        lows.append(round(base * 0.985, 2))

    entry_price = prices[-1]

    for score in (75.0, 62.0, 52.0, 40.0):
        print()
        print(f'--- Score = {score} (entry={entry_price:.2f}) ---')
        result = engine.calculate_dynamic_target_stop(
            entry_price=entry_price,
            prices=prices,
            highs=highs,
            lows=lows,
            score=score,
            support=min(prices[-30:]),
            resistance=max(prices[-30:]),
            ticker='COMI',
            sector='القطاع المالي',
            is_ramadan=False,
        )
        for k, v in result.items():
            print(f"  {k}: {v}")

    # Ramadan test
    print()
    print('--- Ramadan test (score=62, is_ramadan=True) ---')
    result = engine.calculate_dynamic_target_stop(
        entry_price=entry_price,
        prices=prices,
        highs=highs,
        lows=lows,
        score=62.0,
        support=None,
        resistance=None,
        ticker='COMI',
        is_ramadan=True,
    )
    for k, v in result.items():
        print(f"  {k}: {v}")

    # No-S/R, no-ATR fallback test (use only closes)
    print()
    print('--- Volatility fallback test (no S/R, only closes) ---')
    result = engine.calculate_dynamic_target_stop(
        entry_price=entry_price,
        prices=prices,
        highs=None,
        lows=None,
        score=62.0,
        support=None,
        resistance=None,
        ticker=None,
    )
    for k, v in result.items():
        print(f"  {k}: {v}")

    print()
    print('=' * 80)
    print('Smoke test complete.')

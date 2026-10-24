"""
Technical Target Engine (محرك المستهدفات الفنية)
====================================================
محرك متكامل لحساب المستهدف ووقف الخسارة بناءً على:
1. نقاط الدعم والمقاومة من التحليل الفنى (swing-based S/R)
2. تحليل الشموع اليابانية (candlestick patterns)
3. ATR (Average True Range) من الشموع
4. تاريخ السهم (30-day high/low, swing highs/lows)
5. المؤشرات الفنية (RSI, Bollinger Bands, etc.)

الفلسفة:
- المستهدف ووقف الخسارة لازم يكونوا بناءً على التحليل الفنى مش نسب ثابتة
- أولوية: الدعم/المقاومة → الشموع اليابانية → ATR → تاريخ السعر → تقلب احتياطى

Author: دليل الاستثمار
"""

from __future__ import annotations

import sqlite3
import os
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field

from analyzers.indicators.atr import calc_atr as _canonical_calc_atr


# ==================== CONFIG ====================

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_STOCKS_DB = os.environ.get(
    "DATABASE_PATH",
    str(_PROJECT_ROOT / "db" / "stocks.db"),
)
DEFAULT_PRICE_HISTORY_DB = os.environ.get(
    "PRICE_HISTORY_DB",
    str(_PROJECT_ROOT / "db" / "price_history.db"),
)


@dataclass
class TechnicalTargetResult:
    """نتيجة محرك المستهدفات الفنية"""
    # Stop Loss
    stop_price: float = 0.0
    stop_pct: float = 0.0
    stop_method: str = 'DEFAULT'  # SUPPORT, ATR, CANDLESTICK, LOW_30D, VOLATILITY

    # Target
    target_price: float = 0.0
    target_pct: float = 0.0
    target_method: str = 'DEFAULT'  # RESISTANCE, CANDLESTICK, RR, HIGH_30D, VOLATILITY

    # Risk/Reward
    risk_reward: float = 0.0
    entry_price: float = 0.0

    # Data used for calculation
    support_used: float = 0.0
    resistance_used: float = 0.0
    atr_used: float = 0.0
    candlestick_pattern: str = ''
    candlestick_direction: str = ''

    # Additional S/R levels
    far_support: float = 0.0
    far_resistance: float = 0.0
    zone: str = 'middle'  # near_support, near_resistance, middle, breakout, breakdown

    # Method trace (for debugging/transparency)
    calculation_trace: List[str] = field(default_factory=list)


class TechnicalTargetEngine:
    """
    محرك المستهدفات الفنية

    يجمع بين:
    - support_resistance_calculator → لحساب الدعم/المقاومة الحقيقية من swing detection
    - candlestick → لتحليل أنماط الشموع اليابانية
    - calc_atr → لحساب ATR من الشموع
    - تاريخ السعر → لـ 30-day high/low

    Usage:
        engine = TechnicalTargetEngine()
        result = engine.calculate(
            ticker='COMI',
            entry_price=25.50,
            score=65,
        )
        print(f"Stop: {result.stop_price} ({result.stop_method})")
        print(f"Target: {result.target_price} ({result.target_method})")
    """

    def __init__(self, db_path: str = None, price_history_db: str = None):
        self.db_path = db_path or DEFAULT_STOCKS_DB
        self.price_history_db = price_history_db or DEFAULT_PRICE_HISTORY_DB

    def calculate(
        self,
        ticker: str,
        entry_price: float,
        score: float = 50,
        # Pre-calculated values (if available, skip DB lookups)
        support: float = None,
        resistance: float = None,
        far_support: float = None,
        far_resistance: float = None,
        atr: float = None,
        atr_pct: float = None,
        high_30d: float = None,
        low_30d: float = None,
        volatility: float = 3.0,
        # Price data (if available, skip DB lookups)
        price_history: List[Dict] = None,
        # Additional context
        rsi: float = None,
        bb_lower: float = None,
        bb_upper: float = None,
        zone: str = None,
        # DATA-01 HOTFIX (Phase A): direction-aware output.
        # The engine structurally finds support BELOW entry (→ LONG stop) and
        # resistance ABOVE entry (→ LONG target). For direction='SHORT' the
        # final target/stop are swapped so the result is valid for a short
        # trade (target under entry, stop over entry) and the R:R is computed
        # with the SHORT formula. Default 'LONG' preserves existing behavior.
        direction: str = 'LONG',
    ) -> TechnicalTargetResult:
        """
        حساب المستهدف ووقف الخسارة بناءً على التحليل الفنى الكامل

        الأولوية:
        - Stop: Support → Candlestick → ATR → Low 30d → Volatility
        - Target: Resistance → Candlestick → R:R → High 30d → Volatility

        DATA-01: لو direction='SHORT'، الـ target/stop النهائيين بيتـ swap-وا
        عشان يبقوا صحيحين للـ short (target تحت الدخول، stop فوق الدخول).
        """
        trace = []
        result = TechnicalTargetResult(entry_price=entry_price)

        if not entry_price or entry_price <= 0:
            return result

        # ========================================
        # STEP 0: Gather data from price history if not provided
        # ========================================
        if price_history is None:
            price_history = self._load_price_history(ticker)

        # If we don't have S/R from the proper calculator, calculate it
        if support is None or resistance is None:
            sr_data = self._calculate_support_resistance(ticker, price_history)
            if sr_data:
                if support is None:
                    support = sr_data.get('support', 0)
                if resistance is None:
                    resistance = sr_data.get('resistance', 0)
                if far_support is None:
                    far_support = sr_data.get('far_support', 0)
                if far_resistance is None:
                    far_resistance = sr_data.get('far_resistance', 0)
                if zone is None:
                    zone = sr_data.get('zone', 'middle')
                trace.append(f"S/R from swing detection: support={support:.2f}, resistance={resistance:.2f}, zone={zone}")

        # If we don't have ATR, calculate it
        if atr is None or atr_pct is None:
            atr_calc = self._calculate_atr(price_history)
            if atr is None:
                atr = atr_calc
            if atr_pct is None and atr and entry_price > 0:
                atr_pct = (atr / entry_price) * 100

        # If we don't have 30d high/low, calculate it
        if high_30d is None or low_30d is None:
            high_30d_calc, low_30d_calc = self._calculate_30d_range(price_history)
            if high_30d is None:
                high_30d = high_30d_calc
            if low_30d is None:
                low_30d = low_30d_calc

        # Detect candlestick patterns
        candlestick_signal = self._detect_candlestick_patterns(price_history)

        # Store data in result
        result.support_used = support or 0
        result.resistance_used = resistance or 0
        result.atr_used = atr or 0
        result.far_support = far_support or 0
        result.far_resistance = far_resistance or 0
        result.zone = zone or 'middle'

        if candlestick_signal:
            result.candlestick_pattern = candlestick_signal.get('pattern', '')
            result.candlestick_direction = candlestick_signal.get('direction', '')

        # ========================================
        # STEP 1: Calculate STOP LOSS
        # Priority: Support → Candlestick → ATR → Low 30d → Bollinger → Volatility
        # ========================================
        stop_candidates = []

        # Method 1: Support-based stop (HIGHEST PRIORITY)
        if support and support > 0 and support < entry_price:
            # Stop just below support (3% below for wiggle room)
            support_stop = support * 0.97
            support_stop_pct = (entry_price - support_stop) / entry_price
            if 0.005 <= support_stop_pct <= 0.25:
                stop_candidates.append((support_stop, 'SUPPORT', 1.0))
                trace.append(f"SUPPORT stop: {support_stop:.2f} ({support_stop_pct*100:.1f}% below entry)")

        # Method 2: Candlestick pattern-based stop
        if candlestick_signal and candlestick_signal.get('direction') == 'BULLISH':
            cs_stop = candlestick_signal.get('stop_loss', 0)
            if cs_stop and cs_stop > 0 and cs_stop < entry_price:
                cs_stop_pct = (entry_price - cs_stop) / entry_price
                if 0.005 <= cs_stop_pct <= 0.25:
                    stop_candidates.append((cs_stop, 'CANDLESTICK', 0.95))
                    trace.append(f"CANDLESTICK stop ({candlestick_signal['pattern']}): {cs_stop:.2f} ({cs_stop_pct*100:.1f}%)")

        # Method 3: ATR-based stop (from Japanese candlestick analysis)
        if atr and atr > 0 and entry_price > 0:
            # Standard: entry - 1.5 × ATR (covers 1.5 average true ranges)
            atr_stop = entry_price - (1.5 * atr)
            atr_stop_pct = (entry_price - atr_stop) / entry_price
            if 0.005 <= atr_stop_pct <= 0.25:
                stop_candidates.append((atr_stop, 'ATR', 0.9))
                trace.append(f"ATR stop: {atr_stop:.2f} (1.5×ATR={1.5*atr:.2f})")
        elif atr_pct and atr_pct > 0:
            atr_stop_pct = atr_pct * 1.5 / 100.0
            if 0.005 <= atr_stop_pct <= 0.25:
                atr_stop = entry_price * (1 - atr_stop_pct)
                stop_candidates.append((atr_stop, 'ATR_PCT', 0.9))
                trace.append(f"ATR% stop: {atr_stop:.2f} ({atr_stop_pct*100:.1f}%)")

        # Method 4: Low of 30 days (price history)
        if low_30d and low_30d > 0 and low_30d < entry_price:
            low_stop = low_30d * 0.98  # 2% below 30-day low
            low_stop_pct = (entry_price - low_stop) / entry_price
            if 0.005 <= low_stop_pct <= 0.25:
                stop_candidates.append((low_stop, 'LOW_30D', 0.7))
                trace.append(f"LOW_30D stop: {low_stop:.2f} ({low_stop_pct*100:.1f}%)")

        # Method 5: Bollinger Band lower band
        if bb_lower and bb_lower > 0 and bb_lower < entry_price:
            bb_stop = bb_lower * 0.99  # 1% below lower BB
            bb_stop_pct = (entry_price - bb_stop) / entry_price
            if 0.005 <= bb_stop_pct <= 0.20:
                stop_candidates.append((bb_stop, 'BOLLINGER', 0.65))
                trace.append(f"BOLLINGER stop: {bb_stop:.2f} ({bb_stop_pct*100:.1f}%)")

        # Method 6: Volatility-based stop (FALLBACK - lowest priority)
        if volatility <= 0:
            volatility = 3.0
        vol_stop_pct = volatility * 1.2 / 100.0
        vol_stop_pct = max(0.01, min(0.20, vol_stop_pct))
        stop_candidates.append((entry_price * (1 - vol_stop_pct), 'VOLATILITY', 0.5))
        trace.append(f"VOLATILITY stop (fallback): {entry_price * (1 - vol_stop_pct):.2f} ({vol_stop_pct*100:.1f}%)")

        # Choose the best stop: prefer highest confidence method
        if stop_candidates:
            stop_candidates.sort(key=lambda x: (-x[2], x[0]))
            stop_loss = stop_candidates[0][0]
            stop_method = stop_candidates[0][1]
            trace.append(f"→ Selected stop: {stop_loss:.2f} via {stop_method}")
        else:
            stop_loss = entry_price * 0.92  # 8% default
            stop_method = 'DEFAULT'
            trace.append(f"→ Default stop: {stop_loss:.2f} (8%)")

        # Score adjustment: tighter stop for high confidence signals
        actual_stop_pct = (entry_price - stop_loss) / entry_price
        if score >= 70:
            tighter_stop = entry_price - (entry_price - stop_loss) * 0.85
            stop_loss = tighter_stop
            stop_method += '+TIGHT'
            trace.append(f"Score {score}≥70 → Tightened stop to {stop_loss:.2f}")
        elif score < 48:
            wider_stop = entry_price - (entry_price - stop_loss) * 1.2
            stop_loss = wider_stop
            stop_method += '+WIDE'
            trace.append(f"Score {score}<48 → Widened stop to {stop_loss:.2f}")

        # Ensure stop is below entry
        if stop_loss >= entry_price:
            stop_loss = entry_price * 0.92
            stop_method = 'DEFAULT'

        actual_stop_pct = (entry_price - stop_loss) / entry_price

        # ========================================
        # STEP 2: Calculate TARGET
        # Priority: Resistance → Candlestick → R:R → High 30d → Bollinger → Volatility
        # ========================================
        target_candidates = []

        # Score-based minimum R:R ratio
        if score >= 70:
            min_rr = 3.0
        elif score >= 58:
            min_rr = 2.5
        elif score >= 48:
            min_rr = 2.0
        else:
            min_rr = 1.5

        # Method 1: Resistance-based target (HIGHEST PRIORITY)
        if resistance and resistance > entry_price:
            resistance_target = resistance * 0.98  # 2% below resistance
            resistance_target_pct = (resistance_target - entry_price) / entry_price
            rr_from_resistance = resistance_target_pct / actual_stop_pct if actual_stop_pct > 0 else 0
            if rr_from_resistance >= 1.0:  # At least 1:1 R:R
                target_candidates.append((resistance_target, 'RESISTANCE', 1.0))
                trace.append(f"RESISTANCE target: {resistance_target:.2f} (R:R={rr_from_resistance:.1f})")

            # Also check far resistance as extended target
            if far_resistance and far_resistance > entry_price:
                far_target = far_resistance * 0.97
                far_target_pct = (far_target - entry_price) / entry_price
                if far_target_pct >= 0.02:  # At least 2%
                    target_candidates.append((far_target, 'FAR_RESISTANCE', 0.8))
                    trace.append(f"FAR_RESISTANCE target: {far_target:.2f} ({far_target_pct*100:.1f}%)")

        # Method 2: Candlestick pattern-based target
        if candlestick_signal and candlestick_signal.get('direction') == 'BULLISH':
            cs_target = candlestick_signal.get('target_price', 0)
            if cs_target and cs_target > entry_price:
                cs_target_pct = (cs_target - entry_price) / entry_price
                if cs_target_pct >= 0.01:
                    # Adjust candlestick target: use the pattern's implied target × pattern strength
                    strength_mult = candlestick_signal.get('strength_mult', 1.0)
                    adjusted_target = entry_price + (cs_target - entry_price) * strength_mult
                    target_candidates.append((adjusted_target, 'CANDLESTICK', 0.85))
                    trace.append(f"CANDLESTICK target ({candlestick_signal['pattern']}): {adjusted_target:.2f} ({cs_target_pct*100:.1f}%)")

        # Method 3: R:R based target (derived from stop loss)
        rr_target = entry_price + (entry_price - stop_loss) * min_rr
        rr_target_pct = (rr_target - entry_price) / entry_price
        if 0.01 <= rr_target_pct <= 0.60:
            target_candidates.append((rr_target, f'RR_{min_rr}', 0.8))
            trace.append(f"R:R target ({min_rr}:1): {rr_target:.2f} ({rr_target_pct*100:.1f}%)")

        # Method 4: High of 30 days (price history)
        if high_30d and high_30d > entry_price:
            high_target = high_30d * 0.98  # 2% below 30-day high
            high_target_pct = (high_target - entry_price) / entry_price
            if high_target_pct >= 0.01:
                target_candidates.append((high_target, 'HIGH_30D', 0.7))
                trace.append(f"HIGH_30D target: {high_target:.2f} ({high_target_pct*100:.1f}%)")

        # Method 5: Bollinger Band upper band
        if bb_upper and bb_upper > entry_price:
            bb_target = bb_upper * 1.01  # 1% above upper BB
            bb_target_pct = (bb_target - entry_price) / entry_price
            if 0.01 <= bb_target_pct <= 0.40:
                target_candidates.append((bb_target, 'BOLLINGER', 0.6))
                trace.append(f"BOLLINGER target: {bb_target:.2f} ({bb_target_pct*100:.1f}%)")

        # Method 6: Volatility-based target (FALLBACK)
        vol_target_pct = actual_stop_pct * min_rr
        if 0.01 <= vol_target_pct <= 0.60:
            target_candidates.append((entry_price * (1 + vol_target_pct), 'VOLATILITY', 0.5))
            trace.append(f"VOLATILITY target (fallback): {entry_price * (1 + vol_target_pct):.2f} ({vol_target_pct*100:.1f}%)")

        # Choose the best target
        if target_candidates:
            # Prefer resistance-based if available, then candlestick, then by confidence
            target_candidates.sort(key=lambda x: (-x[2], -x[0]))
            best = target_candidates[0]
            target_price = best[0]
            target_method = best[1]

            # Check if the best target meets minimum R:R
            actual_target_pct = (target_price - entry_price) / entry_price
            actual_rr = actual_target_pct / actual_stop_pct if actual_stop_pct > 0 else 0

            # If best target doesn't meet min R:R, try R:R-based instead
            if actual_rr < min_rr and len(target_candidates) > 1:
                for tc in target_candidates:
                    tc_pct = (tc[0] - entry_price) / entry_price
                    tc_rr = tc_pct / actual_stop_pct if actual_stop_pct > 0 else 0
                    if tc_rr >= min_rr:
                        target_price = tc[0]
                        target_method = tc[1]
                        break
                else:
                    target_price = entry_price + (entry_price - stop_loss) * min_rr
                    target_method = f'RR_{min_rr}_ENFORCED'
                    trace.append(f"→ None meet min R:R {min_rr}, enforced R:R target: {target_price:.2f}")
        else:
            target_price = entry_price * 1.10  # 10% default
            target_method = 'DEFAULT'
            trace.append(f"→ Default target: {target_price:.2f} (10%)")

        # Ensure target is above entry
        if target_price <= entry_price:
            target_price = entry_price + (entry_price - stop_loss) * min_rr

        # ══════════════════════════════════════════════════════════
        # حد أقصى للمستهدف — مفيش سهم بيصعد أكتر من 40% كأول مستهدف
        # للأسهم الرخيصة أقل من 2 جنيه، ممكن نوصل لـ 60%
        # ══════════════════════════════════════════════════════════
        max_target_pct = 40.0
        if entry_price < 2.0:
            max_target_pct = 60.0

        max_target_price = entry_price * (1 + max_target_pct / 100)
        if target_price > max_target_price:
            trace.append(f"⚠️ Target {target_price:.2f} > entry*(1 + {max_target_pct}%) — تم تحديد الهدف عند الحد الأقصى")
            target_price = max_target_price
            target_method += '_CAPPED'

        # ========================================
        # STEP 3: Final calculations
        # ========================================
        actual_target_pct = (target_price - entry_price) / entry_price
        actual_stop_pct = (entry_price - stop_loss) / entry_price

        # DATA-01 HOTFIX (Phase A): direction-aware final output.
        # The engine computes LONG geometry (stop below, target above). For
        # direction='SHORT', swap target/stop so the result is valid for a
        # short trade and recompute R:R with the SHORT formula.
        _direction = str(direction or 'LONG').upper().strip()
        if _direction == 'SHORT':
            _long_target = target_price
            _long_stop = stop_loss
            # SHORT target = the LONG stop (below entry), SHORT stop = the LONG target (above entry)
            target_price = _long_stop
            stop_loss = _long_target
            # Guard against degenerate cases
            # Task FINALIZE-UNIFICATION (Rule 27 — NO-FAKE-DATA):
            # Previously fabricated as entry_price * 0.95 / * 1.05 when the
            # LONG geometry produced wrong-direction values for SHORT. Now:
            # set to None — the downstream R:R computation will skip and
            # result.target_price/stop_price will be None (Rule 27).
            if target_price >= entry_price:
                target_price = None
            if stop_loss <= entry_price:
                stop_loss = None
            # Rule 27: if either is None, skip R:R computation (cannot
            # compute a real risk_reward without both real target + stop).
            if target_price is not None and stop_loss is not None:
                actual_target_pct = (entry_price - target_price) / entry_price  # positive for SHORT
                actual_stop_pct = (stop_loss - entry_price) / entry_price        # positive for SHORT
                risk = stop_loss - entry_price     # SHORT risk: stop above entry
                reward = entry_price - target_price  # SHORT reward: target below entry
                # Rule 54: استخدم canonical compute_risk_reward
                try:
                    from utils.risk_reward import compute_risk_reward
                    risk_reward = compute_risk_reward(entry_price, target_price, stop_loss, fallback=0.0)
                except Exception:
                    risk_reward = reward / risk if risk > 0 else 0
            else:
                actual_target_pct = None
                actual_stop_pct = None
                risk = 0
                reward = 0
                risk_reward = None
            target_method = (target_method or '') + '_SHORT'
            stop_method = (stop_method or '') + '_SHORT'
            # Rule 27: handle None target/stop in trace formatting.
            _t_str = f"{target_price:.2f}" if target_price is not None else "None"
            _s_str = f"{stop_loss:.2f}" if stop_loss is not None else "None"
            _rr_str = f"{risk_reward:.2f}" if risk_reward is not None else "None"
            trace.append(f"DATA-01 SHORT swap → target={_t_str} (under), stop={_s_str} (over), R:R={_rr_str}")
        else:
            risk = entry_price - stop_loss
            reward = target_price - entry_price
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                risk_reward = compute_risk_reward(entry_price, target_price, stop_loss, fallback=0.0)
            except Exception:
                risk_reward = reward / risk if risk > 0 else 0

        # Rule 27 (FINALIZE-UNIFICATION): handle None stop_loss/target_price/
        # actual_*_pct/risk_reward (SHORT degenerate case). round(None, ...) crashes.
        result.stop_price = round(stop_loss, 2) if stop_loss is not None else None
        result.stop_pct = round(actual_stop_pct * 100, 1) if actual_stop_pct is not None else None
        result.stop_method = stop_method
        result.target_price = round(target_price, 2) if target_price is not None else None
        result.target_pct = round(actual_target_pct * 100, 1) if actual_target_pct is not None else None
        result.target_method = target_method
        result.risk_reward = round(risk_reward, 2) if risk_reward is not None else None
        result.calculation_trace = trace

        return result

    # ==================== DATA LOADING ====================

    def _load_price_history(self, ticker: str, days: int = 90) -> List[Dict]:
        """Load price history from DB"""
        try:
            db_path = self.price_history_db
            if not os.path.exists(db_path):
                return []

            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(db_path, writable=False)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute(
                """
                SELECT date, open_price, high_price, low_price, close_price, volume
                FROM price_history
                WHERE ticker = ?
                ORDER BY date DESC
                LIMIT ?
                """,
                (ticker.upper(), int(days)),
            )
            rows = [dict(r) for r in cur.fetchall()]
            conn.close()
            rows.reverse()  # oldest → newest
            return rows
        except Exception as e:
            print(f"[TechnicalTargetEngine] Price history DB error for {ticker}: {e}")
            return []

    # ==================== SUPPORT/RESISTANCE CALCULATION ====================

    def _calculate_support_resistance(self, ticker: str, price_history: List[Dict] = None) -> Optional[Dict]:
        """
        Calculate S/R using the proper swing detection algorithm.
        Falls back to support_resistance_calculator module if available.
        """
        try:
            # Try using the dedicated S/R calculator
            from analyzers.support_resistance_calculator import calculate_support_resistance
            sr = calculate_support_resistance(ticker, db_path=self.price_history_db)
            if sr and sr.get('is_fresh'):
                return sr
        except ImportError:
            pass
        except Exception as e:
            print(f"[TechnicalTargetEngine] S/R calculator error: {e}")

        # Fallback: calculate S/R from price history directly using swing detection
        if price_history and len(price_history) >= 30:
            return self._calculate_sr_from_history(price_history)

        return None

    def _calculate_sr_from_history(self, rows: List[Dict], lookback: int = 5) -> Optional[Dict]:
        """
        Calculate S/R from price history using swing detection.
        Same algorithm as support_resistance_calculator but inline.
        """
        if not rows or len(rows) < 30:
            return None

        current_price = float(rows[-1].get("close_price", 0))
        if current_price <= 0:
            return None

        # Detect swing highs
        swing_highs = []
        n = len(rows)
        for i in range(lookback, n - lookback):
            center_high = float(rows[i].get("high_price", 0))
            if center_high <= 0:
                continue
            is_max = True
            for j in range(i - lookback, i + lookback + 1):
                if j == i:
                    continue
                other_high = float(rows[j].get("high_price", 0))
                if other_high >= center_high:
                    is_max = False
                    break
            if is_max:
                swing_highs.append(center_high)

        # Detect swing lows
        swing_lows = []
        for i in range(lookback, n - lookback):
            center_low = float(rows[i].get("low_price", 0))
            if center_low <= 0:
                continue
            is_min = True
            for j in range(i - lookback, i + lookback + 1):
                if j == i:
                    continue
                other_low = float(rows[j].get("low_price", 0))
                if other_low <= center_low:
                    is_min = False
                    break
            if is_min:
                swing_lows.append(center_low)

        # Find nearest support below and resistance above
        supports_below = [s for s in swing_lows if 0 < s < current_price]
        resistances_above = [r for r in swing_highs if r > current_price]

        supports_below.sort(key=lambda x: current_price - x)  # nearest first
        resistances_above.sort(key=lambda x: x - current_price)  # nearest first

        support = supports_below[0] if supports_below else 0.0
        resistance = resistances_above[0] if resistances_above else 0.0
        far_support = supports_below[1] if len(supports_below) >= 2 else support
        far_resistance = resistances_above[1] if len(resistances_above) >= 2 else resistance

        # Determine zone
        if support > 0 and (current_price - support) / support < 0.05:
            zone = 'near_support'
        elif resistance > 0 and (resistance - current_price) / current_price < 0.05:
            zone = 'near_resistance'
        elif not supports_below and resistances_above:
            zone = 'breakdown'
        elif supports_below and not resistances_above:
            zone = 'breakout'
        else:
            zone = 'middle'

        return {
            'support': round(support, 4),
            'resistance': round(resistance, 4),
            'far_support': round(far_support, 4),
            'far_resistance': round(far_resistance, 4),
            'zone': zone,
            'current_price': round(current_price, 4),
        }

    # ==================== ATR CALCULATION ====================

    def _calculate_atr(self, price_history: List[Dict], period: int = 14) -> float:
        """Calculate ATR from price history.

        BRAVO UNIFY: delegates to canonical analyzers.indicators.atr.calc_atr (Wilder's smoothing).
        Keeps backward-compat fallback (0.0) on insufficient data.
        """
        if not price_history or len(price_history) < period + 1:
            return 0

        try:
            highs = [float(r.get('high_price', 0)) for r in price_history if r.get('high_price')]
            lows = [float(r.get('low_price', 0)) for r in price_history if r.get('low_price')]
            closes = [float(r.get('close_price', 0)) for r in price_history if r.get('close_price')]

            if len(highs) < period + 1 or len(lows) < period + 1 or len(closes) < period + 1:
                return closes[-1] * 0.03 if closes else 0

            atr = _canonical_calc_atr(highs, lows, closes, period)
            return atr if atr is not None else 0.0
        except Exception as e:
            print(f"[TechnicalTargetEngine] ATR calculation error: {e}")
            return 0.0

    # ==================== 30-DAY RANGE ====================

    def _calculate_30d_range(self, price_history: List[Dict]) -> Tuple[Optional[float], Optional[float]]:
        """Calculate 30-day high and low from price history"""
        if not price_history:
            return None, None

        recent = price_history[-30:] if len(price_history) >= 30 else price_history

        highs = [float(r.get('high_price', 0)) for r in recent if r.get('high_price', 0)]
        lows = [float(r.get('low_price', 0)) for r in recent if r.get('low_price', 0)]

        high_30d = max(highs) if highs else None
        low_30d = min(lows) if lows else None

        return high_30d, low_30d

    # ==================== CANDLESTICK PATTERN DETECTION ====================

    def _detect_candlestick_patterns(self, price_history: List[Dict]) -> Optional[Dict]:
        """
        Detect candlestick patterns and return signal with target/stop suggestions.
        Returns dict with: pattern, direction, stop_loss, target_price, strength_mult
        """
        if not price_history or len(price_history) < 5:
            return None

        try:
            from analyzers.candlestick import CandlestickAnalyzer, CandleData

            # Convert price history to CandleData
            # مراجعة (يوليو 2026): float(None) بيرمي TypeError — لازم نتعامل مع None values
            candles = []
            for row in price_history[-10:]:  # Last 10 candles
                # safe_float: لو value None → رجّع 0
                def _sf(v):
                    try:
                        return float(v) if v is not None else 0.0
                    except (ValueError, TypeError):
                        return 0.0

                open_p = _sf(row.get('open_price'))
                high_p = _sf(row.get('high_price'))
                low_p = _sf(row.get('low_price'))
                close_p = _sf(row.get('close_price'))
                try:
                    from utils.helpers import parse_volume
                    vol = float(parse_volume(row.get('volume', 0))) if row.get('volume') else None
                except Exception:
                    vol = None

                if open_p > 0 and close_p > 0:
                    candles.append(CandleData(
                        open=open_p,
                        high=high_p,
                        low=low_p,
                        close=close_p,
                        volume=vol,
                    ))

            if len(candles) < 3:
                return None

            # Determine trend
            closes = [c.close for c in candles]
            if len(closes) >= 5:
                first_half = sum(closes[:len(closes)//2]) / (len(closes)//2)
                second_half = sum(closes[len(closes)//2:]) / (len(closes) - len(closes)//2)
                if second_half > first_half * 1.02:
                    trend = "UPTREND"
                elif second_half < first_half * 0.98:
                    trend = "DOWNTREND"
                else:
                    trend = "NEUTRAL"
            else:
                trend = "NEUTRAL"

            analyzer = CandlestickAnalyzer()
            signals = analyzer.analyze_candles_batch(candles, trend=trend)

            if not signals:
                return None

            # Get the best bullish signal for buy recommendations
            bullish_signals = [s for s in signals if s.signal_direction == 'BULLISH']
            if not bullish_signals:
                return None

            best_signal = max(bullish_signals, key=lambda s: s.confidence)

            # Determine strength multiplier based on pattern and context
            strength_mult = 1.0
            if best_signal.strength == 'STRONG':
                strength_mult = 1.5
            elif best_signal.strength == 'MODERATE':
                strength_mult = 1.2

            # Context enrichment
            enriched = analyzer.enrich_with_context(best_signal, candles, market_regime=trend.replace('TREND', ''))

            return {
                'pattern': enriched.pattern_name,
                'pattern_ar': enriched.pattern_name_ar,
                'direction': enriched.signal_direction,
                'confidence': enriched.confidence,
                'strength': enriched.strength,
                'strength_label': enriched.strength_label,
                'stop_loss': enriched.stop_loss,
                'target_price': enriched.target_price,
                'strength_mult': strength_mult,
                'context': enriched.context_desc,
                'risk_reward': enriched.risk_reward_ratio,
            }

        except ImportError:
            return None
        except Exception as e:
            print(f"[TechnicalTargetEngine] Candlestick detection error: {e}")
            return None


# ==================== CONVENIENCE FUNCTION ====================

def calculate_technical_targets(
    ticker: str,
    entry_price: float,
    score: float = 50,
    support: float = None,
    resistance: float = None,
    atr: float = None,
    atr_pct: float = None,
    high_30d: float = None,
    low_30d: float = None,
    volatility: float = 3.0,
    rsi: float = None,
    bb_lower: float = None,
    bb_upper: float = None,
) -> Dict:
    """
    Convenience function for calculating technical targets.

    Returns a dict compatible with the existing risk_profile format.
    """
    engine = TechnicalTargetEngine()
    result = engine.calculate(
        ticker=ticker,
        entry_price=entry_price,
        score=score,
        support=support,
        resistance=resistance,
        atr=atr,
        atr_pct=atr_pct,
        high_30d=high_30d,
        low_30d=low_30d,
        volatility=volatility,
        rsi=rsi,
        bb_lower=bb_lower,
        bb_upper=bb_upper,
    )

    return {
        'target_price': result.target_price,
        'target_pct': result.target_pct,
        'stop_loss': result.stop_price,
        'stop_pct': result.stop_pct,
        'risk_reward': result.risk_reward,
        'entry_price': result.entry_price,
        'stop_method': result.stop_method,
        'target_method': result.target_method,
        'support_used': result.support_used,
        'resistance_used': result.resistance_used,
        'atr_used': result.atr_used,
        'candlestick_pattern': result.candlestick_pattern,
        'candlestick_direction': result.candlestick_direction,
        'zone': result.zone,
        'far_support': result.far_support,
        'far_resistance': result.far_resistance,
        'calculation_trace': result.calculation_trace,
    }


# ==================== CLI ====================

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python3 technical_target_engine.py <TICKER> [score]")
        print("Example: python3 technical_target_engine.py COMI 65")
        sys.exit(1)

    _ticker = sys.argv[1]
    _score = float(sys.argv[2]) if len(sys.argv) > 2 else 50

    # Get current price from DB
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(DEFAULT_STOCKS_DB, writable=False)
        cur = conn.cursor()
        cur.execute('SELECT current_price FROM stocks WHERE ticker = ?', (_ticker.upper(),))
        row = cur.fetchone()
        conn.close()
        _price = row[0] if row and row[0] else 0
    except Exception:
        _price = 0

    if _price <= 0:
        print(f"❌ لا يوجد سعر حالى لـ {_ticker}")
        sys.exit(1)

    print(f"\n📊 Technical Target Engine — {_ticker}")
    print(f"   Entry Price: {_price:.2f}")
    print(f"   Score: {_score}")
    print()

    result = calculate_technical_targets(
        ticker=_ticker,
        entry_price=_price,
        score=_score,
    )

    print(f"🛡️  Stop Loss: {result['stop_loss']:.2f} ({result['stop_pct']:.1f}%) via {result['stop_method']}")
    print(f"🎯 Target:    {result['target_price']:.2f} ({result['target_pct']:.1f}%) via {result['target_method']}")
    print(f"📊 R:R:       {result['risk_reward']:.1f}:1")
    print(f"📍 Zone:      {result['zone']}")
    if result['candlestick_pattern']:
        print(f"🕯️  Candlestick: {result['candlestick_pattern']} ({result['candlestick_direction']})")
    print(f"📈 Support:   {result['support_used']:.2f} | Resistance: {result['resistance_used']:.2f}")
    print(f"📐 ATR:       {result['atr_used']:.2f}")

    if result['calculation_trace']:
        print("\n📋 Calculation Trace:")
        for line in result['calculation_trace']:
            print(f"   {line}")

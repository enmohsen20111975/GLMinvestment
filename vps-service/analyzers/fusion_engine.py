#!/usr/bin/env python3
"""
Fusion Engine V20 — Ultimate Fusion (LuxAlgo + BigBeluga + SMC)
=================================================================

المرجعية (Documentation/HOW_WE_ANALYZE_AND_PREDICT.md §19 — Phase 11):
  - LuxAlgo: القنوات السعرية (Basis + Upper/Lower bands) — Donchian-style ATR bands
  - BigBeluga: الفيبوناتشي + الجيب الذهبي (Golden Pocket 0.618 - 0.786)
  - SMC: الهيكل والسيولة (Order Blocks + FVG + Sweeps) — من smc_engine

المكونات:
  1. calculate_bigbeluga_fib() — القنوات + الفيبوناتشي + الجيب الذهبي
  2. calculate_vwap_premium() — القيمة العادلة (VWAP) + العلاوة (Premium/Discount)
  3. calculate_fusion_score() — النتيجة الشاملة (0-100) + Risk (1.5R / 3.0R)

الاستخدام:
    from analyzers.fusion_engine import FusionEngineV20

    fusion = FusionEngineV20(ohlcv)  # list of {'open','high','low','close','volume'}
    smc_data = {'broke_resist': True, 'sweep_low': True, 'active_ob_low': 12.5}
    score, bb_data, fair_value, fair_premium, risk = fusion.calculate_fusion_score(
        smc_data=smc_data,
        rsi=62.0,
        vol_ratio=1.5,
        trend_up=True,
        atr_val=0.35,
        current_price=13.2,
    )

الـ Score Logic (0-100) — P23-CRYPTO-LAB-FUSION rebalanced:
  - الاتجاه العام (trend_up):       +21  (was 30, -30% — SMA-based is LAGGING)
  - SMC broke_resist (BOS):         +56  (was 40, +40% — Order Block is LEADING)
  - SMC sweep_low (Liquidity grab): +49  (was 35, +40% — leading reversal)
  - فوق SMA20 (fallback):          +10  (was 15, -30% — SMA is LAGGING)
  - حجم قوي (vol_ratio > 1.3):      +22  (was 15, +50% — Volume Profile is LEADING)
  - RSI في منطقة صحية (50-75):     +20  (was 15, +30% — leading / divergence proxy)
  - Premium منخفض (< -3%):          +15  (was 10, +50% — VWAP fair value is LEADING)
  - Premium مرتفع (> +5%):          -15  (was -10, +50% — VWAP overpriced penalty)
  - BigBeluga trend صاعد:           +10  (unchanged — Donchian breakout is leading)
  - السعر في الجيب الذهبي:          +15  (unchanged — leading fib zone)

Risk Logic (1.5R / 3.0R):
  - entry = current_price
  - sl = active_ob_low - (atr * 0.5)  [لو فيه OB] | entry - (atr * 1.5)  [fallback]
  - risk = entry - sl
  - tp1 = entry + (risk * 1.5)
  - tp2 = entry + (risk * 3.0)

@author M2y Platform
@version 1.0.0 — يوليو 2026 (Phase 11 — V20 Ultimate Fusion)
"""
from __future__ import annotations

import logging
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    import numpy as np
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False
    logger.warning("[FusionV20] pandas/numpy not available — fusion calculations will be degraded")


class FusionEngineV20:
    """
    Ultimate Fusion Engine V20 — LuxAlgo + BigBeluga + SMC
    """

    def __init__(self, ohlcv: list):
        """
        Args:
            ohlcv: list of dicts with keys: open, high, low, close, volume
                   (时间字段可以是 'time' / 'date' / 'timestamp' — اختياري)
        """
        self.raw_ohlcv = ohlcv or []
        self.df = None
        self.ready = False

        if not HAS_PANDAS or not self.raw_ohlcv or len(self.raw_ohlcv) < 100:
            # لو الـ data أقل من 100 شمعة، الـ LuxAlgo bands + BigBeluga fib مش هتطلع دقيقة.
            # بس الـ Fusion Score لسه يقدر يحسبها (مع fallback).
            if self.raw_ohlcv and len(self.raw_ohlcv) >= 20:
                # على الأقل الـ VWAP + SMA20 يحتاجوا 20 شمعة
                self._build_df_minimal()
            return

        self._build_df()

    def _build_df(self) -> None:
        """يبني DataFrame كامل من الـ OHLCV مع تطبيع الأعمدة."""
        try:
            self.df = pd.DataFrame(self.raw_ohlcv)
            # تطبيع الأعمدة (accept multiple naming conventions)
            col_map = {
                'open_price': 'open',
                'high_price': 'high',
                'low_price': 'low',
                'close_price': 'close',
                'price_date': 'date',
                'timestamp': 'date',
                'time': 'date',
            }
            self.df = self.df.rename(columns={k: v for k, v in col_map.items() if k in self.df.columns})

            # تحويل الأعمدة لأرقام
            for col in ('open', 'high', 'low', 'close', 'volume'):
                if col in self.df.columns:
                    self.df[col] = pd.to_numeric(self.df[col], errors='coerce')

            # إسقاط الصفوف اللي فيها NaN في الأعمدة الحرجة
            required = ['high', 'low', 'close']
            for col in required:
                if col not in self.df.columns:
                    logger.warning(f"[FusionV20] Missing column: {col}")
                    self.df = None
                    return

            self.df = self.df.dropna(subset=required).reset_index(drop=True)
            if len(self.df) < 20:
                logger.warning(f"[FusionV20] Only {len(self.df)} valid rows after dropna")
                self.df = None
                return

            # volume ممكن يبقى NaN (نصّفره)
            if 'volume' in self.df.columns:
                self.df['volume'] = self.df['volume'].fillna(0)
            else:
                self.df['volume'] = 0.0

            self.ready = True
        except Exception as e:
            logger.error(f"[FusionV20] _build_df error: {e}")
            self.df = None
            self.ready = False

    def _build_df_minimal(self) -> None:
        """يبني DataFrame بس من 20+ شمعة (للـ VWAP + SMA20)."""
        try:
            self.df = pd.DataFrame(self.raw_ohlcv)
            col_map = {
                'open_price': 'open',
                'high_price': 'high',
                'low_price': 'low',
                'close_price': 'close',
                'price_date': 'date',
                'timestamp': 'date',
                'time': 'date',
            }
            self.df = self.df.rename(columns={k: v for k, v in col_map.items() if k in self.df.columns})
            for col in ('open', 'high', 'low', 'close', 'volume'):
                if col in self.df.columns:
                    self.df[col] = pd.to_numeric(self.df[col], errors='coerce')
            required = ['high', 'low', 'close']
            self.df = self.df.dropna(subset=required).reset_index(drop=True)
            if 'volume' in self.df.columns:
                self.df['volume'] = self.df['volume'].fillna(0)
            else:
                self.df['volume'] = 0.0
            # ready = False ( LuxAlgo/BigBeluga محتاجين 100 شمعة)
            self.ready = False
        except Exception as e:
            logger.debug(f"[FusionV20] _build_df_minimal error: {e}")
            self.df = None
            self.ready = False

    # ====================================================================
    # 1. LuxAlgo Channels + BigBeluga Fibonacci + Golden Pocket
    # ====================================================================

    def calculate_bigbeluga_fib(self) -> Dict[str, Any]:
        """
        محرك BigBeluga + LuxAlgo:
          - basis = SMA(close, 100)
          - atr_proxy = max(high, 100) - min(low, 100)  [Donchian-style]
          - upper_band = basis + atr * 3.0
          - lower_band = basis - atr * 3.0
          - trend = 1 (up) / -1 (down) / 0 (range)
          - fib_618, fib_786 (Golden Pocket) حسب الاتجاه
          - in_pocket: السعر داخل الجيب الذهبي؟

        Returns:
            {
                'trend': int (-1, 0, 1),
                'in_pocket': bool,
                'fib_618': float,
                'fib_786': float,
                'basis': float,
                'upper_band': float,
                'lower_band': float,
            }
        """
        empty = {
            'trend': 0, 'in_pocket': False,
            'fib_618': 0.0, 'fib_786': 0.0,
            'basis': 0.0, 'upper_band': 0.0, 'lower_band': 0.0,
        }
        if self.df is None or not self.ready or len(self.df) < 100:
            return empty

        try:
            closes = self.df['close'].astype(float)
            highs = self.df['high'].astype(float)
            lows = self.df['low'].astype(float)

            # 1. Basis = SMA(close, 100)
            basis = closes.rolling(window=100, min_periods=50).mean()

            # 2. ATR proxy = (max high over 100) - (min low over 100)
            #    ده تقريب لـ Donchian channel width (أوسع من ATR الحقيقي)
            high_max = highs.rolling(window=100, min_periods=50).max()
            low_min = lows.rolling(window=100, min_periods=50).min()
            atr_proxy = (high_max - low_min).fillna(0)

            # 3. Upper/Lower Bands
            upper_band = basis + (atr_proxy * 3.0)
            lower_band = basis - (atr_proxy * 3.0)

            # 4. Trend detection
            last_close = float(closes.iloc[-1])
            prev_upper = float(upper_band.iloc[-2]) if len(upper_band) >= 2 else 0
            prev_lower = float(lower_band.iloc[-2]) if len(lower_band) >= 2 else 0

            trend = 0
            if prev_upper > 0 and last_close > prev_upper:
                trend = 1  # breakout up
            elif prev_lower > 0 and last_close < prev_lower:
                trend = -1  # breakout down

            # 5. Fibonacci levels (Golden Pocket: 0.618 - 0.786)
            fib_gold1 = 0.618
            fib_gold2 = 0.786

            last_upper = float(upper_band.iloc[-1]) if not pd.isna(upper_band.iloc[-1]) else 0
            last_lower = float(lower_band.iloc[-1]) if not pd.isna(lower_band.iloc[-1]) else 0

            if trend == 1:
                # In uptrend: project retracement from lower_band up
                fib_618 = last_lower + (last_upper - last_lower) * (1 - fib_gold1)
                fib_786 = last_lower + (last_upper - last_lower) * (1 - fib_gold2)
            elif trend == -1:
                # In downtrend: project retracement from upper_band down
                fib_618 = last_upper - (last_upper - last_lower) * (1 - fib_gold1)
                fib_786 = last_upper - (last_upper - last_lower) * (1 - fib_gold2)
            else:
                # Range: use middle of band
                mid = (last_upper + last_lower) / 2
                fib_618 = mid
                fib_786 = mid

            # 6. Golden Pocket: is price inside [min(fib_618, fib_786), max(fib_618, fib_786)]?
            pocket_low = min(fib_618, fib_786)
            pocket_high = max(fib_618, fib_786)
            in_pocket = bool(pocket_low <= last_close <= pocket_high)

            return {
                'trend': trend,
                'in_pocket': in_pocket,
                'fib_618': round(fib_618, 4),
                'fib_786': round(fib_786, 4),
                'basis': round(float(basis.iloc[-1]) if not pd.isna(basis.iloc[-1]) else 0, 4),
                'upper_band': round(last_upper, 4),
                'lower_band': round(last_lower, 4),
            }
        except Exception as e:
            logger.error(f"[FusionV20] calculate_bigbeluga_fib error: {e}")
            return empty

    # ====================================================================
    # 2. VWAP Fair Value + Premium/Discount
    # ====================================================================

    def calculate_vwap_premium(self) -> Tuple[float, float]:
        """
        حساب VWAP (Volume-Weighted Average Price) + Premium/Discount %.

        Returns:
            (fair_value, fair_premium_percent)
            - fair_value: VWAP على آخر 100 شمعة
            - fair_premium: 100 * (close - vwap) / vwap
              - < 0  → السهم بخصم (رخيص)
              - > 0  → السهم بعلاوة (غالي)
        """
        if self.df is None or len(self.df) < 20:
            # fallback: استخدم آخر close كـ fair_value، premium = 0
            try:
                last_close = float(self.df['close'].iloc[-1]) if self.df is not None and len(self.df) > 0 else 0
                return last_close, 0.0
            except Exception:
                return 0.0, 0.0

        try:
            highs = self.df['high'].astype(float)
            lows = self.df['low'].astype(float)
            closes = self.df['close'].astype(float)
            vols = self.df['volume'].astype(float)

            typical_price = (highs + lows + closes) / 3.0
            window = min(100, len(self.df))
            tail_typ = typical_price.tail(window)
            tail_vol = vols.tail(window)

            total_vol = float(tail_vol.sum())
            total_typ_vol = float((tail_typ * tail_vol).sum())

            fair_value = total_typ_vol / total_vol if total_vol > 0 else float(closes.iloc[-1])
            last_close = float(closes.iloc[-1])
            fair_premium = ((last_close - fair_value) / fair_value) * 100.0 if fair_value > 0 else 0.0

            return round(fair_value, 4), round(fair_premium, 2)
        except Exception as e:
            logger.error(f"[FusionV20] calculate_vwap_premium error: {e}")
            return 0.0, 0.0

    # ====================================================================
    # 3. Fusion Score (0-100) + Risk (1.5R / 3.0R)
    # ====================================================================

    def calculate_fusion_score(
        self,
        smc_data: Optional[Dict[str, Any]] = None,
        # FIX-2 (Rule 24 + owner directive): was `rsi: float = 50.0` (placeholder —
        # caller passed 50.0 when RSI was missing, which then incorrectly applied
        # '+20 RSI healthy' bonus or no penalty). Now Optional[float]=None — when
        # None, the RSI scoring block is skipped entirely (no fake neutral).
        rsi: Optional[float] = None,
        vol_ratio: float = 1.0,
        trend_up: bool = False,
        atr_val: float = 0.0,
        current_price: float = 0.0,
        dip_mode: bool = False,
        distance_from_low_pct: float = 100.0,
        distance_from_high_pct: float = 0.0,
        pe_ratio: float = 0.0,
        roe: float = 0.0,
    ) -> Tuple[float, Dict[str, Any], float, float, Dict[str, Any]]:
        """
        حساب النتيجة الشاملة (Fusion Score) + Risk profile.

        Args:
            smc_data: dict من SMC engine فيه:
                - broke_resist (bool): BOS صعودي (Break of Structure)
                - sweep_low (bool): bullish liquidity sweep
                - active_ob_low (float): أقل سعر في آخر Order Block bullish
            rsi: مؤشر RSI الحالي (0-100)
            vol_ratio: نسبة حجم التداول الحالي إلى المتوسط (1.0 = متوسط)
            trend_up: الاتجاه العام صاعد؟
            atr_val: قيمة ATR الحالية (لحساب الـ stop loss)
            current_price: السعر الحالي
            dip_mode (P27): لو True → السوق هابط (EGX30 < -2%). فعّل منطق
                "الشراء الذكي وقت الهبوط" — مكافأة الأسهم اللي في قاعها التاريخي
                مع أساسيات قوية وحيتان بتدخل، وعقاب الأسهم اللي في قمتها.
            distance_from_low_pct (P27): بُعد السعر الحالي عن أقل قيمة (100%=قمة، 0%=قاع).
            distance_from_high_pct (P27): بُعد السعر الحالي عن أعلى قيمة (0%=قمة، 100%=قاع).
            pe_ratio (P27): P/E ratio للسهم (للـ dip buy logic).
            roe (P27): Return on Equity % (للـ dip buy logic).

        Returns:
            (score, bb_data, fair_value, fair_premium, risk)
            - score: 0-100
            - bb_data: dict من calculate_bigbeluga_fib()
            - fair_value: VWAP
            - fair_premium: %
            - risk: {entry, sl, tp1, tp2, risk_amount}
        """
        smc_data = smc_data or {}
        bb_data = self.calculate_bigbeluga_fib()
        fair_value, fair_premium = self.calculate_vwap_premium()

        score = 0.0
        signals: List[str] = []

        # ──────────────────────────────────────────────────────────────────
        # P23-CRYPTO-LAB-FUSION: Rebalanced score weights (fix lagging indicators)
        # ──────────────────────────────────────────────────────────────────
        # الفلسفة: المؤشرات Lagging (MACD / SMA / EMA) بتأكد الاتجاه بعد ما يبدأ،
        # بينما المؤشرات Leading (SMC / Volume Profile / RSI Divergence) بتتنبأ
        # بالحركة قبل ما تبدأ. التغييرات:
        #   - trend_up (SMA-based): 30 → 21 (-30%, lagging)
        #   - SMC broke_resist (Order Block BOS): 40 → 56 (+40%, leading)
        #   - SMC sweep_low (Liquidity Grab): 35 → 49 (+40%, leading)
        #   - SMA20 fallback: 15 → 10 (-30%, lagging)
        #   - Volume strong (Volume Profile proxy): 15 → 22 (+50%, leading)
        #   - RSI healthy (incl. divergence proxy): 15 → 20 (+30%, leading)
        #   - VWAP Premium reward (Volume Profile / fair value): 10 → 15 (+50%)
        #   - VWAP Premium penalty: -10 → -15 (+50%, symmetric)
        # BigBeluga trend (10) و in_pocket (15) اتساب زي ما هما — دول
        # price-action leading signals (Donchian breakout + Golden Pocket).
        # الـ max score بقى ~159 (clamp 0-100)، فالـ thresholds (STRONG_BUY=70،
        # ACCUMULATE=50) لسه بتميّز الإشارات القوية.
        # ──────────────────────────────────────────────────────────────────

        # 1. الاتجاه العام (was 30 → P23: 21 pts, -30%)
        # P23: trend_up بيستند على SMA50/SMA20 — مؤشر LAGGING (بيأكد الاتجاه
        # بعد ما السعر بدأ). قللنا وزنه عشان ما يدخلش متأخر.
        if trend_up:
            score += 21
            signals.append('✅ اتجاه صاعد +21 (P23: reduced — SMA-based is lagging)')

        # 2. SMC (الهيكل والسيولة) — أعلى أولوية + P23 boost
        # P23: Order Blocks + Liquidity Sweeps هي LEADING indicators بتكشف
        # بصمة المؤسسات (institutional entry/exit) قبل ما السعر يتحرك.
        if smc_data.get('broke_resist'):
            # P23: was 40 → 56 (+40%) — BOS = breakout of structure = leading
            score += 56
            signals.append('✅ BOS صعودي (Break of Structure) +56 (P23: +40% — OB is leading)')
        elif smc_data.get('sweep_low'):
            # P23: was 35 → 49 (+40%) — liquidity grab = leading reversal signal
            score += 49
            signals.append('✅ سحب سيولة بيعية (Bullish Sweep) +49 (P23: +40% — leading)')
        else:
            # fallback: فوق SMA20
            # P23: was 15 → 10 (-30%) — SMA20 lagging fallback
            try:
                if self.df is not None and len(self.df) >= 20:
                    sma20 = self.df['close'].astype(float).rolling(window=20).mean().iloc[-1]
                    last_close = float(self.df['close'].iloc[-1])
                    if not pd.isna(sma20) and last_close > sma20:
                        score += 10
                        signals.append('✅ فوق SMA20 +10 (P23: reduced — SMA is lagging)')
            except Exception:
                pass

        # 3. السيولة والزخم (P23: was 15 + 15 → 22 + 20)
        # P23: Volume strong 15 → 22 (+50%) — Volume Profile reveals hidden
        # accumulation. لو السيولة بتيجي مع السعر، ده accumulation حقيقي.
        if vol_ratio > 1.3:
            score += 22
            signals.append(f'✅ حجم قوي ({vol_ratio:.1f}x) +22 (P23: +50% — Volume Profile is leading)')
        # P23: RSI healthy 15 → 20 (+30%) — RSI in 50-75 zone هو مؤشر leading
        # للـ momentum continuation + بيشتغل كـ proxy للـ RSI Divergence (لو
        # السعر بيعمل higher high والـ RSI بيعمل lower high → bearish div).
        # FIX-2 (Rule 24): guard rsi is not None — was comparing 50 < 50.0 < 75
        # which is False (no bonus) but implied 'we have RSI data and it's 50'.
        # Now if rsi is None → skip the RSI scoring entirely (honest 'no RSI data').
        if rsi is not None and 50 < rsi < 75:
            score += 20
            signals.append(f'✅ RSI صحي ({rsi:.0f}) +20 (P23: +30% — RSI is leading / divergence proxy)')

        # 4. القيمة العادلة (VWAP Premium/Discount) — P23: 50% boost (Volume Profile)
        # P23: was ±10 → ±15 (+50%) — VWAP fair value هو leading indicator
        # بيكشف لو السعر بعلاوة (غالي) أو بخصم (رخيص) بالنسبة للـ volume-weighted avg.
        if fair_premium < -3:
            score += 15
            signals.append(f'✅ سهم بخصم ({fair_premium:.1f}%) +15 (P23: +50% — VWAP fair value is leading)')
        elif fair_premium > 5:
            score -= 15
            signals.append(f'⚠️ سهم بعلاوة ({fair_premium:.1f}%) -15 (P23: +50% — VWAP overpriced penalty)')

        # 5. مكافأة BigBeluga (10 + 15 pts) — unchanged
        # السبب: BigBeluga trend بيعتمد على 100-period Donchian breakout (leading)
        # والـ Golden Pocket 0.618-0.786 fib retracement (leading reversal zone).
        if bb_data['trend'] == 1:
            score += 10
            signals.append('✅ BigBeluga trend صاعد +10 (leading — Donchian breakout)')
        if bb_data['in_pocket']:
            score += 15
            signals.append('🎯 السعر داخل الجيب الذهبي +15 (فرصة شراء ذهبية — leading fib zone)')

        # ──────────────────────────────────────────────────────────────────
        # P27-DIP-BUY: Context-Aware Dip Buying Mode (الشراء الذكي وقت الهبوط)
        # ──────────────────────────────────────────────────────────────────
        # المحلل الخبير بيشتري وقت الهبوط لو السهم "نزل غصب عنه" مع السوق.
        # المكافأة/العقاب بيتحسب من 4 عوامل:
        #   (أ) القاع التاريخي: distance_from_low_pct < 15% → +20 (فرصة ذهبية)
        #       القمة التاريخية: distance_from_high_pct < 10% → -25 (تصريف — فخ!)
        #   (ب) الأساسيات القوية: PE < 20 و ROE > 10 → +15
        #   (ج) الحيتان: SMC broke_resist أو sweep_low → +10 (leading confirmation)
        #   (د) السيولة: vol_ratio > 1.3 → +5 (accumulation حقيقي)
        # لو المجموع الإجمالي ≥ 30 في الـ dip_mode → STRONG_BUY ذكي.
        # ده بيحوّل المنصة من "آلة حاسبة" لـ "محلل خبير بيفكر بالسياق".
        # ──────────────────────────────────────────────────────────────────
        if dip_mode:
            _dip_bonus = 0.0
            _dip_signal_added = False

            # (أ) المسافة من القمة/القاع التاريخي
            if distance_from_low_pct < 15:
                _dip_bonus += 20
                signals.append(
                    f'🔥 [DIP] السهم في قاعه التاريخي (بُعد عن القاع {distance_from_low_pct:.1f}%) +20 '
                    f'(فرصة ذهبية — السوق نازل بس السهم نزل قبله)'
                )
                _dip_signal_added = True
            if distance_from_high_pct < 10:
                _dip_bonus -= 25
                signals.append(
                    f'⚠️ [DIP] السهم في قمته التاريخية (بُعد عن القمة {distance_from_high_pct:.1f}%) -25 '
                    f'(فخ تصريف — الحيتان بتبيع على الـ retail)'
                )

            # (ب) الأساسيات القوية
            if pe_ratio > 0 and pe_ratio < 20 and roe > 10:
                _dip_bonus += 15
                signals.append(
                    f'✅ [DIP] أساسيات قوية (PE={pe_ratio:.1f}, ROE={roe:.1f}%) +15 '
                    f'(الشركة ربحانة — النزول غلط)'
                )
                _dip_signal_added = True

            # (ج) الحيتان (SMC confirmation)
            if smc_data.get('broke_resist') or smc_data.get('sweep_low'):
                _dip_bonus += 10
                signals.append('✅ [DIP] الحيتان بتدخل (SMC confirmed) +10')

            # (د) السيولة
            if vol_ratio > 1.3:
                _dip_bonus += 5
                signals.append(f'✅ [DIP] سيولة قوية ({vol_ratio:.1f}x) +5 (accumulation حقيقي)')

            score += _dip_bonus
            if _dip_signal_added:
                logger.info(
                    f"[P27-DIP-BUY] Fusion dip_bonus={_dip_bonus:+.1f} | "
                    f"dist_low={distance_from_low_pct:.1f}% dist_high={distance_from_high_pct:.1f}% | "
                    f"PE={pe_ratio:.1f} ROE={roe:.1f} | vol={vol_ratio:.1f}x"
                )

        # Clamp 0-100
        score = max(0.0, min(100.0, score))

        # 6. Risk profile (1.5R / 3.0R)
        risk = self._calculate_risk_profile(
            smc_data=smc_data,
            atr_val=atr_val,
            current_price=current_price,
        )

        # لوج ملخص
        # FIX-2 (Rule 24): handle rsi=None in log line (was f'rsi={rsi:.0f}'
        # which would crash on None). Now logs 'rsi=N/A' when no RSI data.
        _rsi_log = f"{rsi:.0f}" if rsi is not None else "N/A"
        logger.info(
            f"[FusionV20] score={score:.1f} | trend={trend_up} | "
            f"smc_bos={smc_data.get('broke_resist')} | smc_sweep={smc_data.get('sweep_low')} | "
            f"rsi={_rsi_log} | vol={vol_ratio:.1f}x | premium={fair_premium:.1f}% | "
            f"bb_trend={bb_data['trend']} | in_pocket={bb_data['in_pocket']} | "
            f"entry={risk['entry']:.2f} sl={risk['sl']:.2f} tp1={risk['tp1']:.2f} tp2={risk['tp2']:.2f}"
        )

        return score, bb_data, fair_value, fair_premium, risk

    def _calculate_risk_profile(
        self,
        smc_data: Optional[Dict[str, Any]] = None,
        atr_val: float = 0.0,
        current_price: float = 0.0,
        signal: Optional[str] = None,
    ) -> Dict[str, float]:
        """
        حساب المخاطر: entry, sl, tp1 (1.5R), tp2 (3.0R).

        Phase 8 — direction-aware (LONG/SHORT):
            - LONG (default): entry=current, sl تحت, tp1/tp2 فوق (المنطق القديم).
            - SHORT (signal in SELL family): sl فوق, tp1/tp2 تحت.

        Logic (LONG):
            - entry = current_price (لو > 0) أو آخر close
            - sl = active_ob_low - (atr * 0.5)  [لو فيه OB]
                   | entry - (atr * 1.5)        [fallback]
            - risk = entry - sl
            - tp1 = entry + (risk * 1.5)
            - tp2 = entry + (risk * 3.0)

        Logic (SHORT):
            - sl = active_ob_high + (atr * 0.5)  [لو فيه OB فوق]
                   | entry + (atr * 1.5)         [fallback]
            - risk = sl - entry
            - tp1 = entry - (risk * 1.5)
            - tp2 = entry - (risk * 3.0)
        """
        smc_data = smc_data or {}

        # direction من الـ signal (لو اتمرّر) — default LONG
        _SELL_FAMILY = {'SELL', 'STRONG_SELL', 'REDUCE', 'SHORT', 'WEAK_SELL', 'BEARISH', 'UNDERWEIGHT'}
        direction = 'SHORT' if (signal and str(signal).upper().strip() in _SELL_FAMILY) else 'LONG'

        # entry
        entry = float(current_price) if current_price and current_price > 0 else 0.0
        if entry <= 0 and self.df is not None and len(self.df) > 0:
            try:
                entry = float(self.df['close'].iloc[-1])
            except Exception:
                entry = 0.0

        # atr fallback: لو ما اديناش atr_val، احسبه من البيانات
        atr = float(atr_val) if atr_val and atr_val > 0 else 0.0
        if atr <= 0 and self.df is not None and len(self.df) >= 14:
            try:
                # ATR-14 approximation: mean of (high - low) over last 14
                last_14 = self.df.tail(14)
                atr = float(((last_14['high'] - last_14['low']).mean()))
            except Exception:
                atr = 0.0

        if direction == 'SHORT':
            # ----- SHORT branch: sl فوق entry، tp1/tp2 تحت entry -----
            active_ob_high = float(smc_data.get('active_ob_high') or smc_data.get('ob_high') or 0)
            if active_ob_high > 0 and atr > 0 and active_ob_high > entry:
                sl = active_ob_high + (atr * 0.5)
            elif atr > 0 and entry > 0:
                sl = entry + (atr * 1.5)
            else:
                # last resort: 5% above entry
                sl = entry * 1.05 if entry > 0 else 0.0

            # risk + targets (SHORT: risk = sl - entry, targets under entry)
            risk_amount = sl - entry if sl > 0 and entry > 0 and sl > entry else 0.0
            if risk_amount > 0:
                tp1 = entry - (risk_amount * 1.5)
                tp2 = entry - (risk_amount * 3.0)
            else:
                # fallback: 5% / 10% targets under entry
                tp1 = entry * 0.95 if entry > 0 else 0.0
                tp2 = entry * 0.90 if entry > 0 else 0.0

            return {
                'direction': 'SHORT',
                'entry': round(entry, 4),
                'sl': round(sl, 4),
                'tp1': round(tp1, 4),
                'tp2': round(tp2, 4),
                'risk_amount': round(risk_amount, 4),
                'rr_ratio_tp1': round((entry - tp1) / risk_amount, 2) if risk_amount > 0 else 0.0,
                'rr_ratio_tp2': round((entry - tp2) / risk_amount, 2) if risk_amount > 0 else 0.0,
            }

        # ----- LONG branch (default — المنطق القديم) -----
        # sl: prefer SMC OB low; fallback to ATR-based
        active_ob_low = float(smc_data.get('active_ob_low') or 0)
        if active_ob_low > 0 and atr > 0 and active_ob_low < entry:
            sl = active_ob_low - (atr * 0.5)
        elif atr > 0 and entry > 0:
            sl = entry - (atr * 1.5)
        else:
            # last resort: 5% below entry
            sl = entry * 0.95 if entry > 0 else 0.0

        # risk + targets
        risk_amount = entry - sl if entry > 0 and sl > 0 else 0.0
        if risk_amount > 0:
            tp1 = entry + (risk_amount * 1.5)
            tp2 = entry + (risk_amount * 3.0)
        else:
            # fallback: 5% / 10% targets
            tp1 = entry * 1.05 if entry > 0 else 0.0
            tp2 = entry * 1.10 if entry > 0 else 0.0

        return {
            'direction': 'LONG',
            'entry': round(entry, 4),
            'sl': round(sl, 4),
            'tp1': round(tp1, 4),
            'tp2': round(tp2, 4),
            'risk_amount': round(risk_amount, 4),
            'rr_ratio_tp1': round((tp1 - entry) / risk_amount, 2) if risk_amount > 0 else 0.0,
            'rr_ratio_tp2': round((tp2 - entry) / risk_amount, 2) if risk_amount > 0 else 0.0,
        }

    # ====================================================================
    # 4. Signal mapping
    # ====================================================================

    @staticmethod
    def score_to_signal(score: float) -> Tuple[str, str]:
        """
        تحويل الـ fusion score لإشارة.

        Returns:
            (signal_en, signal_ar)
            - score >= 70 → STRONG_BUY / شراء قوي
            - score >= 50 → ACCUMULATE / تجميع
            - else        → WAIT / انتظار
        """
        if score >= 70:
            return 'STRONG_BUY', 'شراء قوي'
        elif score >= 50:
            return 'ACCUMULATE', 'تجميع'
        else:
            return 'WAIT', 'انتظار'


# ============================================================================
# Convenience function for direct use
# ============================================================================

def calculate_fusion_metrics(
    ohlcv: list,
    smc_data: Optional[Dict[str, Any]] = None,
    # FIX-2 (Rule 24): was `rsi: float = 50.0` (placeholder) → Optional[float]=None.
    # Now passes None through to calculate_fusion_score when caller has no RSI data
    # (per owner directive: 'مانستعملش بيانات وهمية خالص تحت اى ظرف').
    rsi: Optional[float] = None,
    vol_ratio: float = 1.0,
    trend_up: bool = False,
    atr_val: float = 0.0,
    current_price: float = 0.0,
) -> Dict[str, Any]:
    """
    حساب V20 Fusion metrics في استدعاء واحد.

    Returns:
        {
            'score': float,
            'signal': str,
            'signal_ar': str,
            'fair_value': float,
            'fair_premium': float,
            'bigbeluga': {...},
            'risk': {...},
            'ready': bool,
        }
    """
    fusion = FusionEngineV20(ohlcv)
    score, bb_data, fair_value, fair_premium, risk = fusion.calculate_fusion_score(
        smc_data=smc_data,
        rsi=rsi,
        vol_ratio=vol_ratio,
        trend_up=trend_up,
        atr_val=atr_val,
        current_price=current_price,
    )
    signal_en, signal_ar = FusionEngineV20.score_to_signal(score)

    return {
        'score': round(score, 2),
        'signal': signal_en,
        'signal_ar': signal_ar,
        'fair_value': round(fair_value, 4),
        'fair_premium': round(fair_premium, 2),
        'bigbeluga': bb_data,
        'risk': risk,
        'ready': fusion.ready,
    }

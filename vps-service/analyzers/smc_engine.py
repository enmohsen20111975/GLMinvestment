#!/usr/bin/env python3
"""
SMC Engine - Smart Money Concepts
==================================
محرك تحليل الحيتان (Smart Money) - Phase 6

يكشف:
  1. Swing Highs/Lows - القمم و القيعان
  2. Order Blocks (Bullish + Bearish) - أوردر بلوك
  3. Fair Value Gaps (FVG) - الفجوات
  4. Liquidity Sweeps - سحب السيولة (Stop Hunts)

المنطق: الحيتان (المؤسسات) بتحط أوامرها في مناطق معينة (Order Blocks)،
بتعمل فجوات (FVG) عشان تسرع السعر، و بتسحب السيولة (Sweep) من فوق القمم
و تحت القيعان عشان تملا أوردرها. لو فهمنا ده، نلعب مع الحيتان مش ضدها.
"""

import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

try:
    import pandas as pd
    import numpy as np
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False
    logger.warning("[SMC] pandas/numpy not available - SMC Engine disabled")


class SMCEngine:
    """
    محرك Smart Money Concepts

    Usage:
        smc = SMCEngine(ohlcv)
        order_blocks = smc.get_order_blocks(max_ob_age=30)
        fvgs = smc.get_fvg()
        sweeps = smc.get_liquidity_sweeps()
    """

    def __init__(self, ohlcv: list):
        """
        ohlcv: list of dicts:
            [{'date': int, 'open': float, 'high': float, 'low': float,
              'close': float, 'volume': float}, ...]
        """
        self.raw_ohlcv = ohlcv or []

        if not HAS_PANDAS or not ohlcv or len(ohlcv) < 10:
            self.df = None
            self.ready = False
            return

        try:
            self.df = pd.DataFrame(ohlcv)
            # Ensure required columns exist
            required = ['high', 'low', 'open', 'close']
            for col in required:
                if col not in self.df.columns:
                    logger.warning(f"[SMC] Missing column: {col}")
                    self.ready = False
                    return

            # HOTFIX-P25: حوّل عمود date إلى datetime بشكل آمن.
            # قبل ده، date كان string مثل '2026-03-25' فكان int(date) بيوقع
            # بـ "invalid literal for int() with base 10: '2026-03-25'".
            # pd.to_datetime بيتعامل مع كل الصيغ (string/int/float/NaT).
            if 'date' in self.df.columns:
                self.df['date'] = pd.to_datetime(self.df['date'], errors='coerce')

            # Drop rows with NaN in critical columns
            self.df = self.df.dropna(subset=required).reset_index(drop=True)
            if len(self.df) < 10:
                self.ready = False
                return

            self.ready = True
        except Exception as e:
            logger.error(f"[SMC] Init error: {e}")
            self.df = None
            self.ready = False

    def _date_to_int(self, date_val, fallback_idx: int = 0) -> int:
        """
        HOTFIX-P25: تحويل آمن لأي قيمة تاريخ إلى int (epoch seconds).

        يتعامل مع:
          - str  مثل '2026-03-25' أو '2026-03-25 14:30:00'
          - pandas.Timestamp / datetime.datetime
          - int / float (يرجعها كما هي لو رقم صحيح)
          - NaT / None / NaN → fallback_idx

        ده بيمنع خطأ: invalid literal for int() with base 10: '2026-03-25'
        """
        try:
            if date_val is None:
                return fallback_idx
            # لو بالفعل رقم صحيح
            if isinstance(date_val, (int, np.integer)):
                return int(date_val)
            if isinstance(date_val, (float, np.floating)):
                if not np.isfinite(date_val):
                    return fallback_idx
                return int(date_val)
            # لو Timestamp / datetime
            if hasattr(date_val, 'timestamp'):
                ts = date_val.timestamp()
                return int(ts) if ts == ts else fallback_idx  # NaN check
            # لو string
            ts = pd.Timestamp(date_val)
            if pd.isna(ts):
                return fallback_idx
            return int(ts.timestamp())
        except Exception:
            return fallback_idx

    def detect_swing_points(self, lookback: int = 5) -> 'pd.DataFrame':
        """
        يكشف القمم و القيعان (Swing Highs/Lows)

        Swing High: شمعة الهاي فيها = أعلى هاي في نافذة (lookback*2+1)
        Swing Low: شمعة اللو فيها = أقل لو في نافذة (lookback*2+1)
        """
        if not self.ready or self.df is None:
            return self.df

        try:
            window = lookback * 2 + 1
            highs = self.df['high'].rolling(window=window, center=True).max()
            lows = self.df['low'].rolling(window=window, center=True).min()

            self.df['is_swing_high'] = self.df['high'] == highs
            self.df['is_swing_low'] = self.df['low'] == lows
        except Exception as e:
            logger.error(f"[SMC] detect_swing_points error: {e}")

        return self.df

    def get_order_blocks(self, max_ob_age: int = 30) -> List[Dict[str, Any]]:
        """
        يكشف الـ Order Blocks (آخر شمعة معاكسة قبل الاختراق)

        Bullish OB: آخر شمعة حمراء (close < open) قبل كسر المقاومة صعوداً
        Bearish OB: آخر شمعة خضراء (close > open) قبل كسر الدعم هبوطاً

        Args:
            max_ob_age: أقصى عمر للـ OB بالشموع من آخر شمعة (Phase 3).
                OB أقدم من ده بيتجاهل (الـ structural_resistance لازم تكون
                من أحدث ترند). Default: 30 شمعة.
        """
        if not self.ready or self.df is None:
            return []

        self.detect_swing_points()
        blocks = []

        try:
            last_swing_low_idx = None
            last_swing_high_idx = None

            for i in range(len(self.df)):
                row = self.df.iloc[i]

                if row.get('is_swing_low', False):
                    last_swing_low_idx = i
                if row.get('is_swing_high', False):
                    last_swing_high_idx = i

                # ===== Bullish Order Block =====
                # شرط الكسر الصعودي: الإغلاق فوق آخر Swing High
                if (last_swing_high_idx is not None and
                    last_swing_low_idx is not None and
                    row['close'] > self.df.iloc[last_swing_high_idx]['high']):

                    # ابحث عن آخر شمعة حمراء قبل الكسر
                    search_start = max(last_swing_low_idx, 0)
                    for j in range(i - 1, search_start - 1, -1):
                        if j < 0:
                            break
                        candle = self.df.iloc[j]
                        if candle['close'] < candle['open']:
                            # شمعة حمراء = Bullish OB
                            blocks.append({
                                'type': 'bullish_ob',
                                'top': float(candle['high']),
                                'bottom': float(candle['low']),
                                'index': int(j),
                                'time': self._date_to_int(candle['date'], j) if 'date' in candle else j,
                                'mitigated': False,
                            })
                            break

                # ===== Bearish Order Block =====
                # شرط الكسر الهبوطي: الإغلاق تحت آخر Swing Low
                if (last_swing_low_idx is not None and
                    last_swing_high_idx is not None and
                    row['close'] < self.df.iloc[last_swing_low_idx]['low']):

                    # ابحث عن آخر شمعة خضراء قبل الكسر
                    search_start = max(last_swing_high_idx, 0)
                    for j in range(i - 1, search_start - 1, -1):
                        if j < 0:
                            break
                        candle = self.df.iloc[j]
                        if candle['close'] > candle['open']:
                            # شمعة خضراء = Bearish OB
                            blocks.append({
                                'type': 'bearish_ob',
                                'top': float(candle['high']),
                                'bottom': float(candle['low']),
                                'index': int(j),
                                'time': self._date_to_int(candle['date'], j) if 'date' in candle else j,
                                'mitigated': False,
                            })
                            break

        except Exception as e:
            logger.error(f"[SMC] get_order_blocks error: {e}")

        # Phase 3 (SMC Precision): فلترة الـ OBs القديمة.
        # لو الـ OB أقدم من max_ob_age شمعة من آخر شمعة → تجاهله.
        # الـ structural_resistance لازم تكون من أحدث ترند (Recent OB)، مش من
        # مقاومة قديمة اتكسرت من زمان.
        if max_ob_age > 0 and blocks and self.df is not None:
            _last_idx = len(self.df) - 1
            blocks = [b for b in blocks if (_last_idx - b.get('index', 0)) <= max_ob_age]

        return blocks

    def get_fvg(self) -> List[Dict[str, Any]]:
        """
        يكشف الفجوات (Fair Value Gaps)

        Bullish FVG: لو شمعة 3 Low > شمعة 1 High (فجوة صعودية)
        Bearish FVG: لو شمعة 3 High < شمعة 1 Low (فجوة هبوطية)
        """
        if not self.ready or self.df is None:
            return []

        fvgs = []

        try:
            for i in range(2, len(self.df)):
                c1_high = self.df.iloc[i - 2]['high']
                c1_low = self.df.iloc[i - 2]['low']
                c3_high = self.df.iloc[i]['high']
                c3_low = self.df.iloc[i]['low']
                c3_time = self._date_to_int(self.df.iloc[i]['date'], i) if 'date' in self.df.columns else i

                # Bullish FVG: Low of candle 3 > High of candle 1
                if c3_low > c1_high:
                    fvgs.append({
                        'type': 'bullish_fvg',
                        'top': float(c3_low),
                        'bottom': float(c1_high),
                        'index': int(i),
                        'time': c3_time,
                    })
                # Bearish FVG: High of candle 3 < Low of candle 1
                elif c3_high < c1_low:
                    fvgs.append({
                        'type': 'bearish_fvg',
                        'top': float(c1_low),
                        'bottom': float(c3_high),
                        'index': int(i),
                        'time': c3_time,
                    })
        except Exception as e:
            logger.error(f"[SMC] get_fvg error: {e}")

        return fvgs

    def get_liquidity_sweeps(self) -> List[Dict[str, Any]]:
        """
        يكشف سحب السيولة (Stop Hunts)

        Bullish Sweep: السعر نزل تحت آخر Swing Low ثم أغلق فوقه
            → الحيتان سحبت سيولة البيع (stops) ثم رفعت السعر
        Bearish Sweep: السعر طلع فوق آخر Swing High ثم أغلق تحته
            → الحيتان سحبت سيولة الشراء ثم نزلت السعر
        """
        if not self.ready or self.df is None:
            return []

        sweeps = []
        self.detect_swing_points(lookback=3)

        try:
            for i in range(1, len(self.df)):
                # احصل على Swing Highs/Lows السابقة
                prev_data = self.df.iloc[:i]
                swing_highs = prev_data[prev_data['is_swing_high']]['high'] if 'is_swing_high' in prev_data.columns else pd.Series(dtype=float)
                swing_lows = prev_data[prev_data['is_swing_low']]['low'] if 'is_swing_low' in prev_data.columns else pd.Series(dtype=float)

                prev_swing_high = swing_highs.max() if len(swing_highs) > 0 else None
                prev_swing_low = swing_lows.min() if len(swing_lows) > 0 else None

                current = self.df.iloc[i]
                current_time = self._date_to_int(current['date'], i) if 'date' in self.df.columns else i

                # Bullish Sweep: نزل تحت الدعم ثم أغلق فوقه
                if (prev_swing_low is not None and
                    not pd.isna(prev_swing_low) and
                    current['low'] < prev_swing_low and
                    current['close'] > prev_swing_low):
                    sweeps.append({
                        'type': 'bullish_sweep',
                        'index': int(i),
                        'time': current_time,
                        'level': float(prev_swing_low),
                    })

                # Bearish Sweep: طلع فوق المقاومة ثم أغلق تحتها
                if (prev_swing_high is not None and
                    not pd.isna(prev_swing_high) and
                    current['high'] > prev_swing_high and
                    current['close'] < prev_swing_high):
                    sweeps.append({
                        'type': 'bearish_sweep',
                        'index': int(i),
                        'time': current_time,
                        'level': float(prev_swing_high),
                    })

        except Exception as e:
            logger.error(f"[SMC] get_liquidity_sweeps error: {e}")

        return sweeps

    def get_all_smc_data(self, max_ob_age: int = 30) -> Dict[str, Any]:
        """
        يجمع كل بيانات SMC في dict واحد (للـ API response)
        """
        return {
            'order_blocks': self.get_order_blocks(max_ob_age=max_ob_age),
            'fvgs': self.get_fvg(),
            'sweeps': self.get_liquidity_sweeps(),
            'ready': self.ready,
        }


# ============================================================================
# Helper: حساب الـ SMC Score للـ Confluence
# ============================================================================

def calculate_smc_score(
    ohlcv: list,
    current_price: float,
    volume_ratio: float = 1.0,
    rsi: float = 50.0,
    sma200: float = 0,
) -> Dict[str, Any]:
    """
    يحسب الـ SMC Score (من 100) بدل الـ MACD/Bollinger

    Returns:
        {
            'score': int,           # 0-100
            'order_blocks': list,
            'fvgs': list,
            'sweeps': list,
            'signals': list,        # شرح كل نقطة
        }
    """
    # P26-SMC-SAFE: لفّينا الجسم كامل في try/except عشان أي خطأ (KeyError,
    # division by zero, NaN, إلخ) ما يوقعش الباك-إند. لو وقع → score=0.
    try:
        smc = SMCEngine(ohlcv)
        if not smc.ready:
            return {
                'score': 0,
                'order_blocks': [],
                'fvgs': [],
                'sweeps': [],
                'signals': ['SMC Engine not ready (insufficient data)'],
            }

        order_blocks = smc.get_order_blocks(max_ob_age=30)  # Phase 3: filter OBs > 30 candles
        fvgs = smc.get_fvg()
        sweeps = smc.get_liquidity_sweeps()
        signals = []
        score = 0

        # 1. Macro Trend (15 نقطة)
        if sma200 > 0 and current_price > sma200:
            score += 15
            signals.append('✅ السعر فوق SMA200 (اتجاه صعودي) +15')

        # 2. Order Block Proximity (25 نقطة) - السعر قرب من OB بنسبة 1%
        for ob in order_blocks:
            if ob['type'] == 'bullish_ob':
                # السعر قرب من قمة الـ OB (منطقة الشراء)
                if current_price > 0 and abs(current_price - ob['top']) / current_price <= 0.01:
                    score += 25
                    signals.append(f'✅ السعر قرب Bullish OB ({ob["top"]:.2f}) +25')
                    break
            elif ob['type'] == 'bearish_ob':
                # للإشارات البيعية: السعر قرب من قاع الـ OB
                if current_price > 0 and abs(current_price - ob['bottom']) / current_price <= 0.01:
                    score -= 10  # خصم للإشارة البيعية
                    signals.append(f'⚠️ السعر قرب Bearish OB ({ob["bottom"]:.2f}) -10')
                    break

        # 3. Liquidity Sweep (20 نقطة) - آخر sweep
        if sweeps:
            last_sweep = sweeps[-1]
            if last_sweep['type'] == 'bullish_sweep':
                score += 20
                signals.append(f'✅ Bullish Sweep (سحب سيولة بيعية) +20')
            elif last_sweep['type'] == 'bearish_sweep':
                score -= 15
                signals.append(f'⚠️ Bearish Sweep (سحب سيولة شرائية) -15')

        # 4. Fair Value Gap (20 نقطة) - فجوة لسه متسدروش
        for fvg in fvgs:
            if fvg['type'] == 'bullish_fvg' and current_price > fvg['top']:
                score += 20
                signals.append(f'✅ Bullish FVG تحت السعر (زخم صعودي) +20')
                break
            elif fvg['type'] == 'bearish_fvg' and current_price < fvg['bottom']:
                score -= 10
                signals.append(f'⚠️ Bearish FVG فوق السعر (زخم هبوطي) -10')
                break

        # 5. Volume & RSI (20 نقطة)
        if volume_ratio > 1.5:
            score += 10
            signals.append(f'✅ حجم تداول قوي ({volume_ratio:.1f}x) +10')
        if 40 <= rsi <= 60:
            score += 10
            signals.append(f'✅ RSI في منطقة محايدة ({rsi:.0f}) +10')

        score = max(0, min(100, score))

        return {
            'score': score,
            'order_blocks': order_blocks,
            'fvgs': fvgs,
            'sweeps': sweeps,
            'signals': signals,
        }
    except Exception as e:
        logger.error(f"[SMC] calculate_smc_score crashed (returning score=0): {e}")
        return {
            'score': 0,
            'order_blocks': [],
            'fvgs': [],
            'sweeps': [],
            'signals': [f'SMC scoring error: {e}'],
        }

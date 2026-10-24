#!/usr/bin/env python3
"""
Quant Engine - Phase 8 (BRIEF-051)
====================================
محرك الرياضيات الكمية - يترجم V11 Pine Script إلى Python

يحسب:
  1. Z-Score: كشف الشذوذ الإحصائي (تدخل كيان غير طبيعي)
  2. VSA Absorption: تحليل الجهد والنتيجة (امتصاص خفي للحيتان)
  3. TTM Squeeze: رادار الانفجار الإحصائي (هدوء قبل العاصفة)
"""

import logging
import numpy as np
from typing import List, Dict, Any, Tuple, Optional

logger = logging.getLogger(__name__)

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False
    pd = None


class QuantEngine:
    """
    محرك الرياضيات الكمية (Quant Engine)

    Usage:
        quant = QuantEngine(ohlcv)
        z_score = quant.calculate_z_score()
        vsa = quant.detect_vsa_absorption()
        squeeze = quant.detect_ttm_squeeze()
    """

    def __init__(self, ohlcv: list):
        """
        ohlcv: list of dicts [{'date', 'open', 'high', 'low', 'close', 'volume'}, ...]
        """
        self.raw_ohlcv = ohlcv or []
        self.ready = False

        if not HAS_PANDAS or not ohlcv or len(ohlcv) < 20:
            self.df = None
            return

        try:
            self.df = pd.DataFrame(ohlcv)
            # Ensure required columns
            required = ['high', 'low', 'close', 'open', 'volume']
            for col in required:
                if col not in self.df.columns:
                    self.df = None
                    return

            # Drop rows with NaN in critical columns
            self.df = self.df.dropna(subset=required).reset_index(drop=True)
            if len(self.df) < 20:
                self.df = None
                return

            self.ready = True
        except Exception as e:
            logger.error(f"[Quant] Init error: {e}")
            self.df = None
            self.ready = False

    def calculate_z_score(self) -> float:
        """
        كشف الشذوذ الإحصائي (تدخل كيان غير طبيعي)

        Z-Score = (Close - Mean_20) / StdDev_20

        - Z > 1.5: تدخل كيان غير طبيعي (مؤسسة تشتري بشراسة)
        - Z < -1.5: بيع مؤسسي عنيف
        - Z بين -1 و 1: سلوك طبيعي
        """
        if not self.ready or self.df is None:
            return 0.0

        try:
            mean_price = self.df['close'].rolling(window=20).mean()
            std_dev = self.df['close'].rolling(window=20).std()
            z_score = (self.df['close'] - mean_price) / std_dev.replace(0, np.nan)
            z_score = z_score.fillna(0).iloc[-1]
            return float(z_score)
        except Exception as e:
            logger.error(f"[Quant] Z-Score error: {e}")
            return 0.0

    def detect_vsa_absorption(self) -> bool:
        """
        تحليل الجهد والنتيجة (امتصاص خفي للحيتان)

        VSA (Volume Spread Analysis) - امتصاص خفي:
        - الجهد عالي: Volume > 1.5x متوسط 20 يوم
        - النتيجة منخفضة: جسم الشمعة < 30% من نطاق الشمعة
        - صعودي: الإغلاق فوق الافتتاح

        معنى: حجم ضخم بس السعر مش بيتحرك كتير = حوت بيمتص بصمت
        """
        if not self.ready or self.df is None:
            return False

        try:
            vol_sma = self.df['volume'].rolling(window=20).mean()
            high_effort = self.df['volume'].iloc[-1] > (vol_sma.iloc[-1] * 1.5)

            candle_range = self.df['high'].iloc[-1] - self.df['low'].iloc[-1]
            body = abs(self.df['close'].iloc[-1] - self.df['open'].iloc[-1])
            low_result = body < (candle_range * 0.3) if candle_range > 0 else False

            is_bullish = self.df['close'].iloc[-1] > self.df['open'].iloc[-1]

            return bool(high_effort and low_result and is_bullish)
        except Exception as e:
            logger.error(f"[Quant] VSA error: {e}")
            return False

    def detect_ttm_squeeze(self) -> bool:
        """
        رادار الانفجار الإحصائي (هدوء قبل العاصفة)

        TTM Squeeze: Bollinger Bands داخل Keltner Channel = ضغط
        لما الـ BB تطلع بره الـ KC = انفجار سعري وشيك
        """
        if not self.ready or self.df is None:
            return False

        try:
            # Bollinger Bands (20, 2.0)
            bb_mid = self.df['close'].rolling(window=20).mean()
            bb_std = self.df['close'].rolling(window=20).std()
            bb_up = bb_mid + (bb_std * 2.0)
            bb_low = bb_mid - (bb_std * 2.0)

            # Keltner Channel (20, 1.5 ATR)
            kc_mid = self.df['close'].rolling(window=20).mean()
            # True Range
            tr = pd.concat([
                self.df['high'] - self.df['low'],
                abs(self.df['high'] - self.df['close'].shift()),
                abs(self.df['low'] - self.df['close'].shift())
            ], axis=1).max(axis=1)
            atr = tr.rolling(window=20).mean()
            kc_up = kc_mid + (atr * 1.5)
            kc_low = kc_mid - (atr * 1.5)

            # Squeeze ON = BB داخل KC (ضغط)
            squeeze_on = (bb_low.iloc[-1] > kc_low.iloc[-1]) and (bb_up.iloc[-1] < kc_up.iloc[-1])
            return bool(squeeze_on)
        except Exception as e:
            logger.error(f"[Quant] TTM Squeeze error: {e}")
            return False

    def get_all_metrics(self) -> Dict[str, Any]:
        """
        يجمع كل مقاييس الـ Quant في dict واحد
        """
        z = self.calculate_z_score()
        vsa = self.detect_vsa_absorption()
        squeeze = self.detect_ttm_squeeze()

        return {
            'z_score': round(z, 2),
            'stat_anomaly': z > 1.5,  # تدخل كيان غير طبيعي
            'vsa_absorption': vsa,     # امتصاص خفي
            'ttm_squeeze': squeeze,     # طاقة مضغوطة
            'ready': self.ready,
        }

    def calculate_quant_score(self) -> int:
        """
        يحسب الـ Quant Score (من 55 نقطة):
        - Z-Score > 1.5: +25 نقطة (تدخل كيان)
        - VSA Absorption: +20 نقطة (امتصاص خفي)
        - TTM Squeeze: +10 نقطة (طاقة مضغوطة)
        """
        score = 0

        z = self.calculate_z_score()
        if z > 1.5:
            score += 25  # تدخل كيان غير طبيعي
        elif z > 0.5:
            score += 10  # زخم إيجابي

        if self.detect_vsa_absorption():
            score += 20  # امتصاص خفي

        if self.detect_ttm_squeeze():
            score += 10  # طاقة مضغوطة

        return score


# ============================================================================
# Phase 9: Dynamic Risk Engine (V15 Translation)
# ============================================================================

def calculate_kaufman_er(closes: list, period: int = 10) -> float:
    """
    نسبة كوفمان للكفاءة (Kaufman Efficiency Ratio)
    بتفرق بين الترند والعرضي:
    - ER > 0.4: ترند قوي (أهداف موسعة)
    - ER < 0.2: تذبذب عرضي (أهداف سريعة)
    """
    if not closes or len(closes) < period + 1:
        return 0.0
    try:
        change = abs(closes[-1] - closes[-period - 1])
        volatility = sum(abs(closes[i] - closes[i - 1]) for i in range(len(closes) - period, len(closes)))
        return change / volatility if volatility > 0 else 0.0
    except Exception:
        return 0.0


def calculate_dynamic_risk(closes: list, atr_val: float, atr_list: list = None,
                           active_ob_low: float = None) -> dict:
    """
    Phase 9: حساب الستوب والأهداف الديناميكية (V15)

    المعادلات:
    1. Kaufman ER → يحدد هل السوق ترند ولا عرضي
    2. ATR متعدد → يحدد عرض الستوب حسب الهيجان
    3. OB Low → الستوب تحت الـ Order Block لو موجود
    4. R/R ديناميكي → 1:4 للترند، 1:1.5 للعرضي

    Returns:
        {
            'entry': float,
            'stop_loss': float,
            'tp1': float,
            'tp2': float,
            'risk_mode': str,  # 'ترند قوي' أو 'تذبذب عرضي'
            'kaufman_er': float,
            'dyn_sl_mult': float,
            'dyn_rr1': float,
            'dyn_rr2': float,
        }
    """
    if not closes or len(closes) < 2 or atr_val <= 0:
        return {
            'entry': 0, 'stop_loss': 0, 'tp1': 0, 'tp2': 0,
            'risk_mode': 'بيانات غير كافية', 'kaufman_er': 0,
            'dyn_sl_mult': 1.5, 'dyn_rr1': 1.5, 'dyn_rr2': 3.0,
        }

    try:
        import numpy as np
    except ImportError:
        np = None

    entry_p = closes[-1]

    # 1. مضاعف ATR الديناميكي (يتسع مع الهيجان، ويضيق مع الهدوء)
    if atr_list and len(atr_list) >= 10:
        if np:
            atr_avg = float(np.mean(atr_list[-50:])) if len(atr_list) >= 50 else float(np.mean(atr_list))
        else:
            _s = atr_list[-50:] if len(atr_list) >= 50 else atr_list
            atr_avg = sum(_s) / len(_s) if _s else atr_val
    else:
        atr_avg = atr_val

    vol_ratio = atr_avg / atr_val if atr_val > 0 else 1.0
    # لو التذبذب الحالي أعلى من المتوسط → وسّع الستوب
    dyn_sl_mult = max(1.0, min(3.0, 1.0 + (1.0 / vol_ratio)))

    # 2. نسبة العائد الديناميكية (تتسع مع قوة الترند)
    erf = calculate_kaufman_er(closes, 10)
    if erf > 0.4:
        dyn_rr1 = 2.0   # ترند قوي → أهداف موسعة
        dyn_rr2 = 4.0
        risk_mode = 'ترند قوي (أهداف موسعة R/R 1:4)'
    elif erf > 0.2:
        dyn_rr1 = 1.5
        dyn_rr2 = 3.0
        risk_mode = 'ترند متوسط (أهداف متوازنة R/R 1:3)'
    else:
        dyn_rr1 = 1.5   # عرضي → أهداف سريعة
        dyn_rr2 = 2.0
        risk_mode = 'تذبذب عرضي (أهداف سريعة R/R 1:2)'

    # 3. حساب الستوب
    default_sl = entry_p - (atr_val * dyn_sl_mult)

    ob_sl = None
    if active_ob_low and active_ob_low > 0:
        temp_ob_sl = active_ob_low - (atr_val * 0.5 * dyn_sl_mult)
        # الستوب تحت الـ OB بس مش أبعد من 4 ATR
        if (entry_p - temp_ob_sl) <= (atr_val * 4.0) and temp_ob_sl < entry_p:
            ob_sl = temp_ob_sl

    sl_p = ob_sl if ob_sl is not None else default_sl

    # 4. حساب الأهداف
    risk = entry_p - sl_p
    if risk <= 0:
        risk = atr_val * dyn_sl_mult  # fallback

    tp1_p = entry_p + (risk * dyn_rr1)
    tp2_p = entry_p + (risk * dyn_rr2)

    return {
        'entry': round(entry_p, 4),
        'stop_loss': round(sl_p, 4),
        'tp1': round(tp1_p, 4),
        'tp2': round(tp2_p, 4),
        'risk_mode': risk_mode,
        'kaufman_er': round(erf, 3),
        'dyn_sl_mult': round(dyn_sl_mult, 2),
        'dyn_rr1': dyn_rr1,
        'dyn_rr2': dyn_rr2,
    }

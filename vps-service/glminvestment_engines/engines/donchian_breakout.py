"""
engines/donchian_breakout.py — اختراق قنوات دونشيان
=====================================================
المصدر: Richard Donchian + Turtle Traders + Michael Covel "Trend Following"

الفلسفة:
    "السعر هو الحقيقة الوحيدة." كوفل والـ Turtles ما بيحاولوش ينتبهوا،
    بيشتروا لما السعر يكسر أعلى N يوم. ببساطة: اتبع الاتجاه.

القواعد الأصلية للـ Turtles:
    - دخول: اختراق أعلى 20 يوم (إشارة System 1) أو 55 يوم (System 2)
    - خروج: كسر أدنى 10 يوم
    - تأكيد: حجم فوق المتوسط (اختياري بس قوي)
    - فلتر: تجنّب الاختراقات الكاذبة في Stage 4 (ده بنخليه للـ Confluence)

ملاحظة:
    دونشيان لحاله بيطلع إشارات كتير كاذبة. القوة الحقيقية بتظهر
    لما يتلاقى مع Stage 2 + VCP. ده اللي الـ Confluence Engine بيعمله.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import pandas as pd

from ..core.base import EngineResult, Signal, SignalType, Timeframe
from ..core.indicators import donchian_channels, sma


# ──────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class DonchianConfig:
    """إعدادات اختراق دونشيان."""
    entry_period: int = 20          # أعلى 20 يوم (System 1 الأصلية)
    exit_period: int = 10           # أدنى 10 يوم (للخروج)
    long_entry_period: int = 55     # أعلى 55 يوم (System 2 — إشارات أقوى)
    volume_sma_period: int = 50     # متوسط الحجم للمقارنة
    volume_confirm_ratio: float = 1.5  # الحجم لازم يكون ≥ 1.5× المتوسط
    volume_confirm_strong: float = 2.0  # ≥ 2× = تأكيد قوي
    min_data_points: int = 60


# ──────────────────────────────────────────────────────────────────────────
# Core detection
# ──────────────────────────────────────────────────────────────────────────

def detect_breakout(df: pd.DataFrame, config: Optional[DonchianConfig] = None) -> dict:
    """
    اكشف اختراق دونشيان في آخر شمعة.

    Returns:
        dict فيه: breakout_20, breakout_55, volume_confirmed, volume_ratio,
                 dc_upper, dc_lower, dc_exit, current_price, details
    """
    cfg = config or DonchianConfig()

    if len(df) < cfg.min_data_points:
        return {"breakout": False, "reason": f"بيانات غير كافية ({len(df)}/{cfg.min_data_points})"}

    dc = donchian_channels(df, entry_period=cfg.entry_period, exit_period=cfg.exit_period)
    # القناة الطويلة (55 يوم) — محسوبة منفصلة
    dc_long_upper = df["high"].rolling(cfg.long_entry_period).max().shift(1)

    current_close = float(df["close"].iloc[-1])
    current_volume = float(df["volume"].iloc[-1])

    dc_upper_20 = float(dc["dc_upper"].iloc[-1])
    dc_lower_20 = float(dc["dc_lower"].iloc[-1])
    dc_exit_low = float(dc["dc_exit_low"].iloc[-1])
    dc_upper_55 = float(dc_long_upper.iloc[-1]) if not math.isnan(dc_long_upper.iloc[-1]) else None

    # فحص الاختراق
    breakout_20 = (not math.isnan(dc_upper_20)) and current_close > dc_upper_20
    breakout_55 = dc_upper_55 is not None and current_close > dc_upper_55

    # تأكيد الحجم
    vol_sma = sma(df["volume"], cfg.volume_sma_period)
    avg_vol = float(vol_sma.iloc[-1]) if not math.isnan(vol_sma.iloc[-1]) else current_volume
    volume_ratio = current_volume / avg_vol if avg_vol > 0 else 1.0
    volume_confirmed = volume_ratio >= cfg.volume_confirm_ratio
    volume_strong = volume_ratio >= cfg.volume_confirm_strong

    # مسافة الاختراق (كم فوق القناة)
    breakout_distance_20 = (current_close - dc_upper_20) / dc_upper_20 if dc_upper_20 > 0 else 0.0

    return {
        "breakout": breakout_20 or breakout_55,
        "breakout_20": breakout_20,
        "breakout_55": breakout_55,
        "volume_confirmed": volume_confirmed,
        "volume_strong": volume_strong,
        "volume_ratio": round(volume_ratio, 3),
        "dc_upper_20": round(dc_upper_20, 4),
        "dc_lower_20": round(dc_lower_20, 4),
        "dc_upper_55": round(dc_upper_55, 4) if dc_upper_55 else None,
        "dc_exit_low": round(dc_exit_low, 4),
        "current_price": round(current_close, 4),
        "breakout_distance": round(breakout_distance_20, 4),
    }


# ──────────────────────────────────────────────────────────────────────────
# Engine entry point
# ──────────────────────────────────────────────────────────────────────────

def analyze(
    df: pd.DataFrame,
    symbol: str,
    config: Optional[DonchianConfig] = None,
) -> EngineResult:
    """
    كاشف اختراق دونشيان.

    Returns:
        EngineResult بـ:
          - STRONG_BUY: اختراق 55 يوم + حجم قوي (≥ 2×)
          - BUY:        اختراق 20 يوم + حجم مؤكد (≥ 1.5×)
          - NEUTRAL:    ما فيش اختراق
          - AVOID:      تحت القناة السفلية (إشارة ضعف)
    """
    cfg = config or DonchianConfig()
    info = detect_breakout(df, cfg)

    if not info.get("breakout") and "reason" in info:
        return EngineResult(
            symbol=symbol,
            signal=Signal(
                signal_type=SignalType.NEUTRAL,
                confidence=0.0,
                engine_name="donchian",
                reason=info["reason"],
                metadata=info,
            ),
            timeframe=Timeframe.DAILY,
        )

    current = info["current_price"]
    dc_lower = info["dc_lower_20"]

    # تحت القناة السفلية = ضعف
    if current < dc_lower:
        return EngineResult(
            symbol=symbol,
            signal=Signal(
                signal_type=SignalType.AVOID,
                confidence=0.60,
                engine_name="donchian",
                reason=f"السعر تحت القناة السفلية ({dc_lower}) — إشارة ضعف",
                metadata=info,
            ),
            timeframe=Timeframe.DAILY,
        )

    # اختراق 55 يوم + حجم قوي
    if info.get("breakout_55") and info.get("volume_strong"):
        return EngineResult(
            symbol=symbol,
            signal=Signal(
                signal_type=SignalType.STRONG_BUY,
                confidence=0.85,
                engine_name="donchian",
                reason=(
                    f"اختراق قوي: كسر أعلى {cfg.long_entry_period} يوم "
                    f"بحجم {info['volume_ratio']:.1f}× المتوسط. بداية اتجاه عنيف محتملة."
                ),
                metadata=info,
            ),
            timeframe=Timeframe.DAILY,
        )

    # اختراق 20 يوم + حجم مؤكد
    if info.get("breakout_20") and info.get("volume_confirmed"):
        return EngineResult(
            symbol=symbol,
            signal=Signal(
                signal_type=SignalType.BUY,
                confidence=0.70,
                engine_name="donchian",
                reason=(
                    f"اختراق أعلى {cfg.entry_period} يوم بحجم "
                    f"{info['volume_ratio']:.1f}×. إشارة دخول Turtle System 1."
                ),
                metadata=info,
            ),
            timeframe=Timeframe.DAILY,
        )

    # اختراق بس بدون حجم
    if info.get("breakout_20") or info.get("breakout_55"):
        return EngineResult(
            symbol=symbol,
            signal=Signal(
                signal_type=SignalType.NEUTRAL,
                confidence=0.45,
                engine_name="donchian",
                reason=(
                    f"اختراق دونشيان بس بدون تأكيد حجم ({info['volume_ratio']:.1f}×). "
                    f"ممكن يكون اختراق كاذب — انتظر حجم."
                ),
                metadata=info,
            ),
            timeframe=Timeframe.DAILY,
        )

    # ما فيش اختراق
    return EngineResult(
        symbol=symbol,
        signal=Signal(
            signal_type=SignalType.NEUTRAL,
            confidence=0.30,
            engine_name="donchian",
            reason=(
                f"السعر ضمن القناة ({dc_lower} - {info['dc_upper_20']}). "
                f"ما فيش اختراق — انتظر."
            ),
            metadata=info,
        ),
        timeframe=Timeframe.DAILY,
    )

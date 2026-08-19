"""
engines/stage2_filter.py — فلتر المرحلة الثانية (Minervini)
=============================================================
المصدر: Mark Minervini — "Trade Like a Stock Market Wizard" + "SEPA"

الفلسفة:
    مينيرفيني بيقسّم دورة حياة السهم لـ 4 مراحل:
      Stage 1: تجميع (قاعدة)     → انتظر
      Stage 2: صعود (اتجاه صاعد) → الشراء هنا فقط ✓
      Stage 3: توزيع (قمة)        → خروج/انتظر
      Stage 4: هبوط               → ممنوع المسه ✓✗

    السر: 80% من الأسهم بتتحرك مع السوق، وأكتر الخسائر بتيجي من
    شراء سهم في Stage 4 (هبوط) بدافع "رخص". ده فلتر صارم.

قواعد Stage 2 الصارمة (كلها لازم تتحقق):
    1. السعر > متوسط 200 يوم
    2. متوسط 200 يوم صاعد (slope موجب آخر 20 يوم)
    3. متوسط 50 يوم > متوسط 200 يوم (Golden Cross)
    4. السعر ضمن 25% من أعلى 52 أسبوع (نشتري القوة مش الضعف)
    5. السعر مش مفرط في الصعود (≤ 70% فوق متوسط 200 — بتجنّب الفقاعات)

النتيجة:
    لو مش Stage 2 → AVOID (يرفض أي إشارة شراء)
    لو Stage 2 → BUY/STRONG_BUY حسب قوة الاتجاه
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd

from core.base import EngineResult, Signal, SignalType, Timeframe
from core.indicators import sma, percentile_rank, adx


# ──────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Stage2Config:
    """إعدادات فلتر المرحلة الثانية."""
    long_sma: int = 200          # متوسط 200 يوم (قاعدة Minervini)
    short_sma: int = 50          # متوسط 50 يوم (تأكيد Golden Cross)
    slope_window: int = 20       # فترة قياس ميل المتوسط (صاعد/هابط)
    high_lookback: int = 252     # 52 أسبوع ≈ 252 يوم تداول
    within_high_pct: float = 0.25  # السعر ضمن 25% من أعلى قمة
    overextended_pct: float = 0.70  # > 70% فوق 200 SMA = مفرط
    # ADX لتأكيد قوة الاتجاه (إضافي على Minervini الأصلي)
    adx_period: int = 14
    adx_strong_trend: float = 25.0   # ADX > 25 = اتجاه قوي
    # الحد الأدنى لعدد البيانات
    min_data_points: int = 210       # لازم 200+ يوم للحساب


# ──────────────────────────────────────────────────────────────────────────
# Stage classification
# ──────────────────────────────────────────────────────────────────────────

def classify_stage(df: pd.DataFrame, config: Optional[Stage2Config] = None) -> dict:
    """
    صنّف السهم لإحدى المراحل الأربع (1/2/3/4).

    Returns:
        dict فيه: stage (1-4), price_vs_sma200, sma200_slope,
                 golden_cross, pct_of_high, adx, details
    """
    cfg = config or Stage2Config()

    if len(df) < cfg.min_data_points:
        return {
            "stage": 0,
            "reason": f"بيانات غير كافية ({len(df)}/{cfg.min_data_points})",
            "price_vs_sma200": None,
            "sma200_slope": None,
            "golden_cross": None,
            "pct_of_high": None,
            "adx": None,
        }

    close = df["close"]
    price = float(close.iloc[-1])

    sma200 = sma(close, cfg.long_sma)
    sma50 = sma(close, cfg.short_sma)
    sma200_now = float(sma200.iloc[-1])
    sma50_now = float(sma50.iloc[-1])

    # ميل متوسط 200 يوم (صاعد/هابط/ساكن)
    sma200_20_ago = float(sma200.iloc[-cfg.slope_window])
    slope = (sma200_now - sma200_20_ago) / sma200_20_ago if sma200_20_ago > 0 else 0.0

    # Golden Cross: SMA50 > SMA200
    golden_cross = sma50_now > sma200_now

    # نسبة السعر من أعلى 52 أسبوع
    high_252 = float(close.rolling(cfg.high_lookback).max().iloc[-1])
    pct_of_high = (high_252 - price) / high_252 if high_252 > 0 else 1.0
    within_range = pct_of_high <= cfg.within_high_pct

    # نسبة السعر فوق/تحت 200 SMA
    price_vs_sma200 = (price - sma200_now) / sma200_now if sma200_now > 0 else 0.0

    # ADX لقياس قوة الاتجاه
    adx_df = adx(df, cfg.adx_period)
    adx_val = float(adx_df["adx"].iloc[-1]) if not math.isnan(adx_df["adx"].iloc[-1]) else 0.0

    # ── منطق التصنيف ──
    price_above_sma200 = price > sma200_now
    sma200_rising = slope > 0.0

    # Stage 2: صعود — كل الشروط
    if price_above_sma200 and sma200_rising and golden_cross and price_vs_sma200 <= cfg.overextended_pct:
        stage = 2
        reason = "Stage 2 — اتجاه صاعد مؤكد (فوق 200SMA + 200SMA صاعد + Golden Cross)"
    # Stage 4: هبوط — تحت 200SMA و 200SMA هابط
    elif (not price_above_sma200) and (not sma200_rising):
        stage = 4
        reason = "Stage 4 — هبوط (تحت 200SMA و 200SMA هابط). ممنوع الشراء."
    # Stage 3: توزيع/قمة — فوق 200SMA بس 200SMA بدأ يفرّد أو السعر مفرط
    elif price_above_sma200 and (not sma200_rising or price_vs_sma200 > cfg.overextended_pct):
        stage = 3
        reason = "Stage 3 — قمة/توزيع (200SMA يفرّد أو السعر مفرط في الصعود). حذر."
    # Stage 1: تجميع — كل الباقي
    else:
        stage = 1
        reason = "Stage 1 — تجميع/قاعدة (ليس في اتجاه صاعد واضح). انتظر."

    return {
        "stage": stage,
        "reason": reason,
        "price_vs_sma200": round(price_vs_sma200, 4),
        "sma200_slope": round(slope, 4),
        "golden_cross": golden_cross,
        "pct_of_high": round(pct_of_high, 4),
        "within_25pct_high": within_range,
        "adx": round(adx_val, 2),
        "sma200": round(sma200_now, 4),
        "sma50": round(sma50_now, 4),
        "price": round(price, 4),
    }


# ──────────────────────────────────────────────────────────────────────────
# Engine entry point
# ──────────────────────────────────────────────────────────────────────────

def analyze(
    df: pd.DataFrame,
    symbol: str,
    config: Optional[Stage2Config] = None,
) -> EngineResult:
    """
    فلتر المرحلة الثانية.

    Returns:
        EngineResult بـ:
          - STRONG_BUY: Stage 2 + ADX قوي + السعر قريب من القمة
          - BUY:        Stage 2 + ADX معتدل
          - NEUTRAL:    Stage 1 (تجميع)
          - AVOID:      Stage 3 (قمة)
          - STRONG_AVOID: Stage 4 (هبوط) — ممنوع الشراء نهائياً
    """
    cfg = config or Stage2Config()
    info = classify_stage(df, cfg)

    stage = info["stage"]

    # البيانات غير كافية
    if stage == 0:
        return EngineResult(
            symbol=symbol,
            signal=Signal(
                signal_type=SignalType.AVOID,
                confidence=0.0,
                engine_name="stage2",
                reason=info["reason"],
                metadata=info,
            ),
            timeframe=Timeframe.DAILY,
        )

    # Stage 4: هبوط — رفض قاطع
    if stage == 4:
        return EngineResult(
            symbol=symbol,
            signal=Signal(
                signal_type=SignalType.STRONG_AVOID,
                confidence=0.95,
                engine_name="stage2",
                reason=info["reason"],
                metadata=info,
            ),
            timeframe=Timeframe.DAILY,
        )

    # Stage 3: قمة — تجنّب
    if stage == 3:
        return EngineResult(
            symbol=symbol,
            signal=Signal(
                signal_type=SignalType.AVOID,
                confidence=0.75,
                engine_name="stage2",
                reason=info["reason"],
                metadata=info,
            ),
            timeframe=Timeframe.DAILY,
        )

    # Stage 1: تجميع — محايد
    if stage == 1:
        return EngineResult(
            symbol=symbol,
            signal=Signal(
                signal_type=SignalType.NEUTRAL,
                confidence=0.40,
                engine_name="stage2",
                reason=info["reason"],
                metadata=info,
            ),
            timeframe=Timeframe.DAILY,
        )

    # Stage 2: صعود — حدد القوة
    adx_val = info.get("adx", 0.0)
    within_high = info.get("within_25pct_high", False)

    # STRONG_BUY: Stage 2 + ADX قوي + السعر قريب من القمة
    if adx_val >= cfg.adx_strong_trend and within_high:
        signal_type = SignalType.STRONG_BUY
        confidence = 0.90
        reason = (
            f"Stage 2 قوي: ADX={adx_val} (اتجاه قوي) + السعر ضمن "
            f"{cfg.within_high_pct:.0%} من القمة. بيئة شراء ممتازة."
        )
    # BUY: Stage 2 أساسي
    elif adx_val >= 20.0:
        signal_type = SignalType.BUY
        confidence = 0.70
        reason = (
            f"Stage 2 صاعد: ADX={adx_val} (اتجاه معتدل). شراء مقبول."
        )
    # Stage 2 ضعيف (ADX منخفض — الاتجاه لسه بيتكوّن)
    else:
        signal_type = SignalType.BUY
        confidence = 0.55
        reason = (
            f"Stage 2 ناشئ: ADX={adx_val} منخفض. اتجاه لسه بيتكوّن — انتظر تأكيد."
        )

    return EngineResult(
        symbol=symbol,
        signal=Signal(
            signal_type=signal_type,
            confidence=confidence,
            engine_name="stage2",
            reason=reason,
            metadata=info,
        ),
        timeframe=Timeframe.DAILY,
    )

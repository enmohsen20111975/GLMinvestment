"""
engines/vcp_detector.py — اكتشاف نموذج تقلص التقلب (VCP)
=========================================================
المصدر: Mark Minervini — "Trade Like a Stock Market Wizard" (الفصل SEPA)

الفلسفة:
    VCP (Volatility Contraction Pattern) هو السر الأكبر لمينيرفيني.
    قبل أي انفجار سعري كبير، بتحصل سلسلة من الانكماشات:
      25% → 10% → 5% → 2-3%
    كل انكماش أضيق من اللي قبله، والحجم بيجفّ في الآخر.
    ده معناه: البائعين خلصوا، التذبذب هيدّي، والسهم جاهز للانطلاق.

    لما المؤسسات تشتري، بتلمّع السهم بتقليل التذبذب. ده الأثر اللي بنقيسه.

خوارزمية الكشف:
    1. حدّد نافذة 4-6 شهور (90-150 شمعة يومية)
    2. لقّي القمة المرجعية (pivot high) في النافذة
    3. من القمة، قسّم التحركات لانكماشات متتالية (swing highs/lows)
    4. كل انكماش = مساحة من القمة لقاع لقمة تالية
    5. شوف الأرقام بتقلّ (contraction ratios متناقصة)
    6. الحجم بيجفّ في آخر انكماش (volume trend هابط)
    7. السعر الحالي قريب من القمة (within 10%) — جاهز للخروج

    VCP مثالي:
      Contraction 1: 22% range
      Contraction 2: 11% range  (نصف الأول)
      Contraction 3: 5% range   (نصف التاني)
      Volume: جاف في آخر 3
      Current: عند أو قريب من القمة
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd

from glminvestment_engines.core.base import EngineResult, Signal, SignalType, Timeframe


# ──────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class VCPConfig:
    """إعدادات كاشف VCP."""
    lookback: int = 120              # ~6 شهور يومي
    min_contractions: int = 2        # أقل عدد انكماشات (VCP صحيح = 2-4)
    max_contractions: int = 5        # أكتر من كده = قاعدة معقدة جداً
    # أقصى نطاق لآخر انكماش (الكلينش) — كل ما أقل كل ما أقوى
    tight_threshold: float = 0.10    # ≤ 10% = انكماش ضيق (قوي)
    medium_threshold: float = 0.15   # ≤ 15% = متوسط
    # نسبة الانكماش المتوقعة (كل واحد ≤ 60% من اللي قبله)
    contraction_decay: float = 0.60
    # السعر لازم يكون قريب من القمة (جاهز للخروج)
    near_high_threshold: float = 0.10  # within 10% of pivot high
    # فترة قياس جفاف الحجم (آخر N شمعة)
    volume_dryup_window: int = 20
    volume_dryup_ratio: float = 0.70  # آخر حجم ≤ 70% من المتوسط السابق
    min_data_points: int = 60


# ──────────────────────────────────────────────────────────────────────────
# Swing detection helper
# ──────────────────────────────────────────────────────────────────────────

def _find_swings(series: pd.Series, order: int = 5) -> list[tuple[int, float, str]]:
    """
    لقّي القمم والقيعان المحلية (swing highs/lows).

    Args:
        series: السلسلة السعرية (عادة close)
        order: عدد الشموع على كل جهة لتأكيد القمة/القاع

    Returns:
        list of (index_position, value, type) where type is 'H' or 'L'
    """
    swings: list[tuple[int, float, str]] = []
    values = series.values
    n = len(values)

    for i in range(order, n - order):
        window_left = values[i - order:i]
        window_right = values[i + 1:i + order + 1]
        is_high = values[i] > window_left.max() and values[i] > window_right.max()
        is_low = values[i] < window_left.min() and values[i] < window_right.min()

        if is_high:
            swings.append((i, float(values[i]), "H"))
        elif is_low:
            swings.append((i, float(values[i]), "L"))

    return swings


# ──────────────────────────────────────────────────────────────────────────
# VCP detection core
# ──────────────────────────────────────────────────────────────────────────

def detect_vcp(df: pd.DataFrame, config: Optional[VCPConfig] = None) -> dict:
    """
    اكشف نموذج VCP في آخر `lookback` شمعة.

    Returns:
        dict فيه: found (bool), contractions (list of {range_pct}),
                 volume_dryup (bool), near_high (bool), pivot_high,
                 current_price, score (0-100), details
    """
    cfg = config or VCPConfig()

    if len(df) < cfg.min_data_points:
        return {"found": False, "reason": f"بيانات غير كافية ({len(df)}/{cfg.min_data_points})"}

    window = df.iloc[-cfg.lookback:] if len(df) >= cfg.lookback else df
    close = window["close"]
    high = window["high"]
    low = window["low"]
    volume = window["volume"]

    current_price = float(close.iloc[-1])

    # القمة المرجعية (pivot high) = أعلى قمة BEFORE آخر 3 شموع.
    # ليه؟ آخر شموع ممكن تكون شمعة الاختراق اللي بتكسر القمة — لو أخذناها،
    # الـ pivot هيتشال للنهاية ونرفض النموذج بالغلط. القمة الحقيقية هي
    # المقاومة اللي السهم بيتختبرها/يكسرها، مش شمعة الاختراق نفسها.
    breakout_zone = 3  # آخر 3 شموع = منطقة اختراق محتملة
    search_zone = high.iloc[:-breakout_zone] if len(high) > breakout_zone else high
    pivot_idx = int(search_zone.values.argmax())
    pivot_high = float(search_zone.iloc[pivot_idx])

    # السعر الحالي لازم يكون بعد القمة (مش قبله)
    if pivot_idx > len(window) - breakout_zone - 2:
        return {"found": False, "reason": "القمة قريبة جداً من النهاية — النموذج لسه ما تكوّنش"}

    # نسبة السعر من القمة
    pct_from_high = (pivot_high - current_price) / pivot_high if pivot_high > 0 else 1.0
    near_high = pct_from_high <= cfg.near_high_threshold

    # لقّي الانكماشات من القمة
    swings = _find_swings(close, order=3)

    # فلتر السوينج بعد القمة فقط
    swings_after_pivot = [(i, v, t) for (i, v, t) in swings if i >= pivot_idx]

    # بناء الانكماشات: من القمة، كل قمة بعدها وقاع بعدها = انكماش
    contractions: list[dict] = []
    current_high = pivot_high
    i = 0
    while i < len(swings_after_pivot) - 1:
        if swings_after_pivot[i][2] == "H":
            high_val = swings_after_pivot[i][1]
            # لقّي القاع اللي بعدها
            j = i + 1
            while j < len(swings_after_pivot) and swings_after_pivot[j][2] != "L":
                j += 1
            if j < len(swings_after_pivot):
                low_val = swings_after_pivot[j][1]
                range_pct = (high_val - low_val) / high_val if high_val > 0 else 0.0
                if range_pct > 0.01:  # تجاهل التذبذب الطفيف
                    contractions.append({
                        "high": round(high_val, 4),
                        "low": round(low_val, 4),
                        "range_pct": round(range_pct, 4),
                    })
                i = j + 1
            else:
                break
        else:
            i += 1

    # قيّم الانكماشات
    num_contractions = len(contractions)
    contractions_valid = cfg.min_contractions <= num_contractions <= cfg.max_contractions

    # هل الانكماشات بتضيق؟ (كل واحد ≤ decay × اللي قبله)
    contraction_ratios = []
    decaying = True
    for k in range(1, len(contractions)):
        prev_range = contractions[k - 1]["range_pct"]
        curr_range = contractions[k]["range_pct"]
        if prev_range > 0:
            ratio = curr_range / prev_range
            contraction_ratios.append(round(ratio, 3))
            if ratio > 1.0:  # اتوسع بدل ما يضيق
                decaying = False

    # آخر انكماش ضيق؟
    last_contraction_range = contractions[-1]["range_pct"] if contractions else 1.0
    is_tight = last_contraction_range <= cfg.tight_threshold
    is_medium = last_contraction_range <= cfg.medium_threshold

    # جفاف الحجم: نقارن حجم فترة الانكماش (قبل شمعة الاختراق المحتملة)
    # بحجم الفترة السابقة. ليه نستثني آخر شمعة؟ لأن شمعة الاختراق بيكون
    # فيها حجم عالي (تأكيد الاختراق) — لو أخذناها في المتوسط هتخفي جفاف
    # الانكماش الحقيقي. الجفاف صفة الانكماش، مش الاختراق.
    # نستخدم median للـ recent عشان نكون مقاومين لشموع الاختراق (outliers).
    # شموع الاختراق ليها حجم عالي جداً بيقفز المتوسط، لكن الـ median بيفضل
    # عند قيمة الانكماش الحقيقية. ده فرق إحصائي مهم للاستدامة.
    vol_end = -1  # استثني آخر شمعة (potential breakout bar)
    recent_slice = volume.iloc[-cfg.volume_dryup_window - 1:vol_end] \
        if len(volume) >= cfg.volume_dryup_window + 1 \
        else (volume.iloc[:-1] if len(volume) > 1 else volume)
    vol_recent = float(recent_slice.median())
    vol_prior_start = -2 * cfg.volume_dryup_window - 1
    vol_prior_end = -cfg.volume_dryup_window - 1
    prior_slice = volume.iloc[vol_prior_start:vol_prior_end] \
        if len(volume) >= 2 * cfg.volume_dryup_window + 1 else recent_slice
    vol_prior = float(prior_slice.median())
    vol_ratio = vol_recent / vol_prior if vol_prior > 0 else 1.0
    volume_dryup = vol_ratio <= cfg.volume_dryup_ratio

    # ── الحكم النهائي ──
    found = (
        contractions_valid
        and decaying
        and (is_tight or is_medium)
        and volume_dryup
        and near_high
    )

    # درجة من 100 (للـ confluence engine)
    score = 0
    if num_contractions >= cfg.min_contractions:
        score += 25
    if decaying and len(contraction_ratios) > 0:
        score += 25
    if is_tight:
        score += 25
    elif is_medium:
        score += 15
    if volume_dryup:
        score += 15
    if near_high:
        score += 10
    score = min(score, 100)

    return {
        "found": found,
        "score": score,
        "pivot_high": round(pivot_high, 4),
        "current_price": round(current_price, 4),
        "pct_from_high": round(pct_from_high, 4),
        "near_high": near_high,
        "num_contractions": num_contractions,
        "contractions": contractions,
        "contraction_ratios": contraction_ratios,
        "decaying": decaying,
        "last_range_pct": round(last_contraction_range, 4),
        "is_tight": is_tight,
        "is_medium": is_medium,
        "volume_dryup": volume_dryup,
        "vol_ratio": round(vol_ratio, 4),
    }


# ──────────────────────────────────────────────────────────────────────────
# Engine entry point
# ──────────────────────────────────────────────────────────────────────────

def analyze(
    df: pd.DataFrame,
    symbol: str,
    config: Optional[VCPConfig] = None,
) -> EngineResult:
    """
    كاشف VCP.

    Returns:
        EngineResult بـ:
          - STRONG_BUY: VCP مثالي (3+ انكماشات + ضيق + جفاف + قرب القمة)
          - BUY:        VCP مقبول (2 انكماش + متوسط)
          - NEUTRAL:    ما فيش VCP واضح
          - AVOID:      النموذج فشل (انكماشات بتتوسع أو حجم بيزيد)
    """
    cfg = config or VCPConfig()
    info = detect_vcp(df, cfg)

    if not info.get("found") and "reason" in info:
        return EngineResult(
            symbol=symbol,
            signal=Signal(
                signal_type=SignalType.NEUTRAL,
                confidence=0.0,
                engine_name="vcp",
                reason=info["reason"],
                metadata=info,
            ),
            timeframe=Timeframe.DAILY,
        )

    score = info["score"]
    found = info["found"]

    # VCP قوي: انكماشات بتضيق + ضيق + جفاف + قرب القمة
    if found and score >= 85:
        signal_type = SignalType.STRONG_BUY
        confidence = score / 100.0
        reason = (
            f"VCP قوي: {info['num_contractions']} انكماشات بتضيق "
            f"(آخر={info['last_range_pct']:.1%}) + حجم جاف "
            f"({info['vol_ratio']:.2f}×) + السعر ضمن {info['pct_from_high']:.1%} من القمة. "
            f"جاهز للانفجار."
        )
    elif found and score >= 65:
        signal_type = SignalType.BUY
        confidence = score / 100.0
        reason = (
            f"VCP مقبول: {info['num_contractions']} انكماشات، "
            f"آخر نطاق={info['last_range_pct']:.1%}. ننتظر تأكيد اختراق بحجم."
        )
    elif info.get("decaying") and info.get("num_contractions", 0) >= 2:
        # الانكماشات بتضيق بس لسه مكملتش — مراقبة
        signal_type = SignalType.NEUTRAL
        confidence = 0.40
        reason = (
            f"VCP ناشئ: {info['num_contractions']} انكماشات بتضيق، "
            f"بس الشروط ناقصة (حجم/ضيق). راقب دون دخول."
        )
    else:
        signal_type = SignalType.NEUTRAL
        confidence = 0.20
        reason = "ما فيش نموذج VCP واضح. انتظر تكوّن النموذج."

    return EngineResult(
        symbol=symbol,
        signal=Signal(
            signal_type=signal_type,
            confidence=confidence,
            engine_name="vcp",
            reason=reason,
            metadata=info,
        ),
        timeframe=Timeframe.DAILY,
    )

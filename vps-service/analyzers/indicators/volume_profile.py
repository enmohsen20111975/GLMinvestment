"""
analyzers/indicators/volume_profile.py — Canonical Volume Profile
=================================================================
**Rule 67 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب Volume Profile في المشروع.

الصيغة:
  - bin prices into N bins (من min low إلى max high)
  - لكل bin، اجمع volume البارات اللي close بتاعها ضمن الـ bin
  - POC (Point of Control) = السعر اللي عليه أكبر volume
  - VAH (Value Area High) = أعلى سعر ضمن 70% من الـ volume
  - VAL (Value Area Low) = أقل سعر ضمن 70% من الـ volume

السبب: كان فيه implementation واحد بس (analyzers/volume_profile.py) بس مكرر
ومدمج مع logic تاني. لازم canonical منفصل عشان أي محرك يستخدمه.

المرجعية:
  - Rule 67 (00-CONSTITUTION.md)
  - Steidlmayer (1980) — Market Profile original concept

الاستخدام:
  from analyzers.indicators import calc_volume_profile
  vp = calc_volume_profile(closes, volumes, bins=20)
  if vp:
      print(vp['poc'], vp['vah'], vp['val'])
"""
from __future__ import annotations
from typing import Optional, List, Dict


def calc_volume_profile(closes: List[float], volumes: List[float],
                        bins: int = 20,
                        value_area_pct: float = 0.70) -> Optional[Dict[str, float]]:
    """حساب Volume Profile (POC + VAH + VAL) — canonical.

    Args:
        closes: إغلاقات الأسعار (آخرها في النهاية)
        volumes: أحجام التداول (آخرها في النهاية)
        bins: عدد bins لتقسيم نطاق السعر (default: 20)
        value_area_pct: نسبة الـ Value Area (default: 0.70 = 70%)

    Returns:
        dict: {poc, vah, val, total_volume, nodes} أو None لو البيانات غير كافية.
        - poc: Point of Control (السعر بأكبر volume)
        - vah: Value Area High (أعلى سعر ضمن value_area_pct من volume)
        - val: Value Area Low (أقل سعر ضمن value_area_pct من volume)
        - total_volume: إجمالي volume
        - nodes: list of {bin_low, bin_high, bin_mid, volume} لكل bin
        القيم rounded لـ 4 أرقام عشرية.

    Notes:
        - لو len(data) < 2 → بـ يرجّع None.
        - لو total_volume == 0 → بـ يرجّع None.
        - الـ value_area بـ يبدأ من POC وبيتمدد للجوارين لحد ما يوصل value_area_pct.
    """
    if not closes or not volumes or len(closes) < 2:
        return None

    min_len = min(len(closes), len(volumes))
    closes = closes[-min_len:]
    volumes = volumes[-min_len:]

    price_min = min(closes)
    price_max = max(closes)
    if price_max == price_min:
        # flat line — كل volume في سعر واحد
        return {
            "poc": round(price_min, 4),
            "vah": round(price_min, 4),
            "val": round(price_min, 4),
            "total_volume": round(sum(volumes), 4),
            "nodes": [{"bin_low": price_min, "bin_high": price_min,
                       "bin_mid": price_min, "volume": sum(volumes)}],
        }

    bin_width = (price_max - price_min) / bins
    bin_volumes = [0.0] * bins
    bin_mids = [price_min + (i + 0.5) * bin_width for i in range(bins)]

    for i in range(len(closes)):
        bin_idx = int((closes[i] - price_min) / bin_width)
        # BRAVO FIX: handle negative bin_idx (floating point rounding edge case)
        if bin_idx < 0:
            bin_idx = 0
        if bin_idx >= bins:
            bin_idx = bins - 1
        bin_volumes[bin_idx] += volumes[i]

    total_volume = sum(bin_volumes)
    if total_volume == 0:
        return None

    # POC = bin بأكبر volume
    poc_idx = max(range(bins), key=lambda i: bin_volumes[i])
    poc = bin_mids[poc_idx]

    # Value Area: ابدأ من POC وتمدد للجوارين لحد ما توصل value_area_pct
    target_volume = total_volume * value_area_pct
    va_volume = bin_volumes[poc_idx]
    lo_idx = poc_idx
    hi_idx = poc_idx
    while va_volume < target_volume and (lo_idx > 0 or hi_idx < bins - 1):
        # وسّع للجهة الأعلى volume
        left_vol = bin_volumes[lo_idx - 1] if lo_idx > 0 else -1
        right_vol = bin_volumes[hi_idx + 1] if hi_idx < bins - 1 else -1
        if right_vol >= left_vol and right_vol >= 0:
            hi_idx += 1
            va_volume += bin_volumes[hi_idx]
        elif left_vol >= 0:
            lo_idx -= 1
            va_volume += bin_volumes[lo_idx]
        else:
            break

    vah = bin_mids[hi_idx]
    val = bin_mids[lo_idx]

    nodes = []
    for i in range(bins):
        nodes.append({
            "bin_low": round(price_min + i * bin_width, 4),
            "bin_high": round(price_min + (i + 1) * bin_width, 4),
            "bin_mid": round(bin_mids[i], 4),
            "volume": round(bin_volumes[i], 4),
        })

    return {
        "poc": round(poc, 4),
        "vah": round(vah, 4),
        "val": round(val, 4),
        "total_volume": round(total_volume, 4),
        "nodes": nodes,
    }

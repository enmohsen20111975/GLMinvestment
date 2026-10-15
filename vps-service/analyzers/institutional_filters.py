#!/usr/bin/env python3
"""
institutional_filters.py — الفلاتر المؤسسية الستة الصارمة (Pine V82 Injection)
=============================================================================
Task BRAVO-PINE-INJECT: حقن فلاتر Pine Script V82 & V60.2 في قلب بايثون.

المرجع: data/pine_scripts/V82_Ultimate_EGX_Engine.pine + V60.2 Who_Is_Buying.

الفلاتر الستة:
  1. is_desert_phase: انكماش ATR < 0.6×SMA(ATR) + هبوط حجم < 0.5×median.
  2. is_wash_trade: حجم > 2×median + مدى ضيق < 0.5×ATR (تدوير وهمي).
  3. limit_up_trap: صعود > 9.5% (ليمت أب) → حظر الشراء.
  4. is_killer_distribution: شمعة هابطة + مدى > 1.5×ATR + حجم > 2×median.
  5. price_extended: السعر فوق EMA20 بأكثر من 0.5×ATR → "ممتد لا تطارد".
  6. who_is_buying: تمييز حجمي مؤسسي vs صغار المتداولين.

Rule 67b: Python = sole calc brain. لا أرقام وهمية. لا except-pass.

Usage:
    from analyzers.institutional_filters import evaluate_entry_gate
    gate = evaluate_entry_gate(candles)
"""
from __future__ import annotations
import sys, os
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

# Load canonical ATR (Rule 67b).
_VPS = str(Path(__file__).resolve().parents[1])
if _VPS not in sys.path:
    sys.path.insert(0, _VPS)
try:
    from analyzers.indicators.atr import calc_atr as _canonical_atr
except Exception:
    _canonical_atr = None


def _to_float(v, default=0.0):
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').strip())
    except (ValueError, TypeError):
        return default


def _ema(data: List[float], period: int) -> float:
    """EMA (recursive) — for EMA20."""
    if len(data) < period:
        return sum(data) / len(data) if data else 0.0
    k = 2 / (period + 1)
    ema = sum(data[:period]) / period
    for p in data[period:]:
        ema = (p - ema) * k + ema
    return ema


def _median(values: List[float]) -> float:
    """Median — for volume median."""
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 == 1 else (s[mid - 1] + s[mid]) / 2


def _compute_atr(candles: List[Dict], period: int = 14) -> float:
    """ATR via canonical (Rule 67b) or inline fallback."""
    highs = [_to_float(c.get('high')) for c in candles]
    lows = [_to_float(c.get('low')) for c in candles]
    closes = [_to_float(c.get('close')) for c in candles]
    if _canonical_atr:
        r = _canonical_atr(highs, lows, closes, period)
        if r is not None:
            return r
    # inline Wilder's fallback.
    if len(closes) < 2:
        return 0.0
    trs = []
    for i in range(1, len(closes)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        trs.append(tr)
    if not trs:
        return 0.0
    if len(trs) < period:
        return sum(trs) / len(trs)
    atr = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return atr


def _sma(values: List[float], period: int) -> float:
    if len(values) < period:
        return sum(values) / len(values) if values else 0.0
    return sum(values[-period:]) / period


def is_desert_phase(candles: List[Dict]) -> Dict[str, Any]:
    """مرحلة الصحراء: انكماش ATR + هبوط حجم (تجميع هادئ)."""
    if len(candles) < 25:
        return {'detected': False, 'reason': 'بيانات غير كافية (<25 شمعة)'}
    closes = [_to_float(c.get('close')) for c in candles]
    volumes = [_to_float(c.get('volume')) for c in candles]
    atr_val = _compute_atr(candles)
    # ATR SMA (over last 20 ATR values — proxy: compute ATR on sliding windows).
    # Simplified: atr_sma = SMA of recent TR values.
    trs = []
    for i in range(1, len(closes)):
        h, l, pc = _to_float(candles[i].get('high')), _to_float(candles[i].get('low')), closes[i - 1]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    atr_sma = _sma(trs, 20) if len(trs) >= 20 else sum(trs) / len(trs) if trs else 0.0
    median_vol = _median(volumes[-20:]) if len(volumes) >= 20 else _median(volumes)
    latest_vol = volumes[-1] if volumes else 0.0
    detected = atr_sma > 0 and atr_val < (atr_sma * 0.60) and median_vol > 0 and latest_vol < (median_vol * 0.5)
    return {
        'detected': detected,
        'atr': round(atr_val, 4), 'atr_sma': round(atr_sma, 4),
        'latest_vol': round(latest_vol, 0), 'median_vol': round(median_vol, 0),
        'reason': 'انكماش ATR + هبوط حجم → تجميع هادئ (صحراء)' if detected else 'ATR/حجم طبيعي',
    }


def is_wash_trade(candles: List[Dict]) -> Dict[str, Any]:
    """التدوير الوهمي: حجم > 2×median + مدى ضيق < 0.5×ATR."""
    if len(candles) < 20:
        return {'detected': False, 'reason': 'بيانات غير كافية'}
    closes = [_to_float(c.get('close')) for c in candles]
    opens = [_to_float(c.get('open')) for c in candles]
    volumes = [_to_float(c.get('volume')) for c in candles]
    atr = _compute_atr(candles)
    median_vol = _median(volumes[-20:])
    latest_vol = volumes[-1] if volumes else 0.0
    o, c = opens[-1], closes[-1]
    candle_range = abs(c - o) if o > 0 else 0.0
    detected = (median_vol > 0 and latest_vol > median_vol * 2.0 and atr > 0 and candle_range < atr * 0.5)
    return {
        'detected': detected, 'atr': round(atr, 4), 'candle_range': round(candle_range, 4),
        'latest_vol': round(latest_vol, 0), 'median_vol': round(median_vol, 0),
        'reason': 'حجم مرتفع + مدى ضيق → تدوير وهمي (wash trade)' if detected else 'حجم/مدى طبيعي',
    }


def limit_up_trap(candles: List[Dict]) -> Dict[str, Any]:
    """ليمت أب: صعود > 9.5% → حظر الشراء."""
    if len(candles) < 2:
        return {'detected': False, 'reason': 'بيانات غير كافية'}
    opens = [_to_float(c.get('open')) for c in candles]
    closes = [_to_float(c.get('close')) for c in candles]
    o, c = opens[-1], closes[-1]
    if o <= 0:
        return {'detected': False, 'reason': 'open=0'}
    pct = ((c - o) / o) * 100.0
    detected = pct > 9.5
    return {
        'detected': detected, 'change_pct': round(pct, 2),
        'reason': f'صعود {pct:.1f}% > 9.5% → ليمت أب (حظر شراء)' if detected else f'صعود {pct:.1f}% طبيعي',
    }


def is_killer_distribution(candles: List[Dict]) -> Dict[str, Any]:
    """التوزيع القاتل: شمعة هابطة + مدى > 1.5×ATR + حجم > 2×median."""
    if len(candles) < 20:
        return {'detected': False, 'reason': 'بيانات غير كافية'}
    opens = [_to_float(c.get('open')) for c in candles]
    closes = [_to_float(c.get('close')) for c in candles]
    volumes = [_to_float(c.get('volume')) for c in candles]
    atr = _compute_atr(candles)
    median_vol = _median(volumes[-20:])
    o, c = opens[-1], closes[-1]
    candle_range = abs(c - o) if o > 0 else 0.0
    latest_vol = volumes[-1] if volumes else 0.0
    detected = (c < o and atr > 0 and candle_range > atr * 1.5 and median_vol > 0 and latest_vol > median_vol * 2.0)
    return {
        'detected': detected, 'atr': round(atr, 4), 'candle_range': round(candle_range, 4),
        'latest_vol': round(latest_vol, 0), 'median_vol': round(median_vol, 0),
        'reason': 'شمعة هابطة + مدى واسع + حجم ضخم → توزيع قاتل' if detected else 'لا توزيع قاتل',
    }


def price_extended(candles: List[Dict]) -> Dict[str, Any]:
    """السعر ممتد فوق EMA20 بأكثر من 0.5×ATR → "ممتد لا تطارد"."""
    if len(candles) < 25:
        return {'detected': False, 'reason': 'بيانات غير كافية'}
    closes = [_to_float(c.get('close')) for c in candles]
    atr = _compute_atr(candles)
    ema20 = _ema(closes, 20)
    latest_close = closes[-1]
    extension = latest_close - ema20
    detected = atr > 0 and extension > atr * 0.5
    return {
        'detected': detected, 'atr': round(atr, 4), 'ema20': round(ema20, 4),
        'extension': round(extension, 4), 'latest_close': round(latest_close, 4),
        'reason': f'السعر ممتد فوق EMA20 بـ {extension:.2f} > 0.5×ATR → استنى تصحيح' if detected else 'السعر قريب من EMA20',
    }


def who_is_buying(candles: List[Dict]) -> Dict[str, Any]:
    """التمييز الحجمي: تدفق مؤسسي ضخم vs رمي صغار المتداولين.
    V60.2: لو الحجم > 1.5×median + الشمعة صاعدة + المدى > 0.7×ATR → مؤسسي.
    لو الحجم > 1.5×median + المدى < 0.3×ATR → صغار (تدوير)."""
    if len(candles) < 20:
        return {'classification': 'neutral', 'reason': 'بيانات غير كافية'}
    opens = [_to_float(c.get('open')) for c in candles]
    closes = [_to_float(c.get('close')) for c in candles]
    volumes = [_to_float(c.get('volume')) for c in candles]
    atr = _compute_atr(candles)
    median_vol = _median(volumes[-20:])
    o, c = opens[-1], closes[-1]
    latest_vol = volumes[-1] if volumes else 0.0
    candle_range = abs(c - o) if o > 0 else 0.0
    is_up = c > o
    vol_surge = median_vol > 0 and latest_vol > median_vol * 1.5
    wide_range = atr > 0 and candle_range > atr * 0.7
    tight_range = atr > 0 and candle_range < atr * 0.3
    if vol_surge and is_up and wide_range:
        classification = 'institutional'
        reason = 'حجم ضخم + شمعة صاعدة + مدى واسع → تدفق مؤسسي (الحيتان بتشتري)'
    elif vol_surge and tight_range:
        classification = 'retail'
        reason = 'حجم ضخم + مدى ضيق → رمي صغار (تدوير هزيل)'
    elif vol_surge and is_up:
        classification = 'mixed'
        reason = 'حجم ضخم + صاعد → تدفق مختلط'
    else:
        classification = 'neutral'
        reason = 'حجم طبيعي → لا نشاط مؤسسي واضح'
    return {
        'classification': classification, 'reason': reason,
        'latest_vol': round(latest_vol, 0), 'median_vol': round(median_vol, 0),
        'vol_surge': vol_surge, 'candle_range': round(candle_range, 4), 'atr': round(atr, 4),
    }


def evaluate_entry_gate(candles: List[Dict], trend_up: bool = True, valid_rr: bool = True) -> Dict[str, Any]:
    """بوابة الدخول المؤسسية الصارمة — كل الفلاتر الستة + قرار القبول/الرفض.
    entry_gate_pass = trend_up AND valid_rr AND NOT killer_distribution AND NOT wash_trade
                      AND NOT limit_up_trap AND NOT price_extended."""
    f1 = is_desert_phase(candles)
    f2 = is_wash_trade(candles)
    f3 = limit_up_trap(candles)
    f4 = is_killer_distribution(candles)
    f5 = price_extended(candles)
    f6 = who_is_buying(candles)
    # Blocks: killer_distribution, wash_trade, limit_up_trap, price_extended → reject BUY.
    blocked = f2['detected'] or f3['detected'] or f4['detected'] or f5['detected']
    gate_pass = trend_up and valid_rr and not blocked
    blockers = []
    if f4['detected']:
        blockers.append(f"🔴 {f4['reason']}")
    if f3['detected']:
        blockers.append(f"🔴 {f3['reason']}")
    if f2['detected']:
        blockers.append(f"🟡 {f2['reason']}")
    if f5['detected']:
        blockers.append(f"🟡 {f5['reason']}")
    return {
        'entry_gate_pass': gate_pass,
        'blocked': blocked,
        'blockers': blockers,
        'filters': {
            'is_desert_phase': f1, 'is_wash_trade': f2, 'limit_up_trap': f3,
            'is_killer_distribution': f4, 'price_extended': f5, 'who_is_buying': f6,
        },
        'verdict': (
            '✅ إشارة شراء مقبولة (بوابة الدخول المؤسسية)' if gate_pass
            else f'⛔ إشارة مرفوضة — {len(blockers)} مانع: {" | ".join(blockers)}' if blockers
            else '⛔ مرفوضة (ترند هابط أو R/R غير صالح)'
        ),
    }

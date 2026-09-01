#!/usr/bin/env python3
"""
V80 Breakout Hunter — محرك صيد الانفجارات
=============================================
بني على تحليل 364 صفقة إنتاج (WR 49.4%) + مقارنة بالأسهم الانفجارية.

الحقائق اللي طلعت من الإنتاج:
  1. الأسهم الغالية (>500 EGP) = WR 21.1% ← ممنوع
  2. الأسهم الرخيصة (5-20 EGP) = WR 59.8% ← الأحسن
  3. SELL signals = WR 14.3% ← ممنوع (بتخسر 86%)
  4. BUY signals = WR 55.7% ← الأحسن
  5. الأسهم اللي فاتت V40.2 (AJWA +43820%, MFPC +11893%) = penny stocks بـ pump فجأة

الاستراتيجية الجديدة:
  1. Scan يومي (مش كل 3 أيام)
  2. ركّز على الأسهم 5-50 EGP (أحسن WR)
  3. ابحث عن breakout من base (مش surge)
  4. stop_loss هيكلي (swing low - 0.5×ATR)
  5. trailing stop بدل fixed target
  6. مفيش SELL signals (كلها BUY بس)

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import math
from typing import List, Optional, Dict, Any, Tuple
from collections import deque


# ═══════════════════════════════════════════════════════════════════════
# 1. Base Detection (القاعدة السعرية)
# ═══════════════════════════════════════════════════════════════════════

def detect_base_formation(
    closes: List[float], volumes: List[float], 
    lookback: int = 20, tightness_pct: float = 15.0
) -> Dict[str, Any]:
    """
    كشف القاعدة السعرية (Base Formation).
    
    القاعدة = السهم تداول في نطاق ضيق (±15%) لمدة 20 يوم على الأقل.
    ده بـ يعني accumulation صامت قبل الانفجار.
    
    Pine logic:
      range_high = highest(high, 20)
      range_low = lowest(low, 20)
      base_tightness = (range_high - range_low) / range_low * 100
      is_base = base_tightness < 15%
    
    Returns:
      {
        'is_base': bool,
        'base_high': float,
        'base_low': float,
        'tightness_pct': float,
        'base_days': int,
      }
    """
    n = len(closes)
    if n < lookback:
        return {'is_base': False, 'base_high': 0, 'base_low': 0, 
                'tightness_pct': 0, 'base_days': 0}
    
    window = closes[-lookback:]
    base_high = max(window)
    base_low = min(window)
    
    if base_low <= 0:
        return {'is_base': False, 'base_high': 0, 'base_low': 0,
                'tightness_pct': 0, 'base_days': 0}
    
    tightness = ((base_high - base_low) / base_low) * 100
    
    # Count how many days in the tight range
    base_days = sum(1 for c in window if base_low * 0.98 <= c <= base_high * 1.02)
    
    return {
        'is_base': tightness < tightness_pct and base_days >= 15,
        'base_high': base_high,
        'base_low': base_low,
        'tightness_pct': round(tightness, 2),
        'base_days': base_days,
    }


# ═══════════════════════════════════════════════════════════════════════
# 2. Breakout Detection (الاختراق)
# ═══════════════════════════════════════════════════════════════════════

def detect_breakout(
    closes: List[float], volumes: List[float], base: Dict[str, Any],
    volume_threshold: float = 1.5
) -> Dict[str, Any]:
    """
    كشف اختراق القاعدة (Breakout).
    
    Breakout = السعر كسر base_high بحجم > 1.5× MA(20).
    
    Pine logic:
      is_breakout = close > base_high and volume > sma(volume, 20) * 1.5
      breakout_strength = (close - base_high) / base_high * 100
    
    Returns:
      {
        'is_breakout': bool,
        'breakout_strength_pct': float,
        'volume_ratio': float,
        'breakout_close': float,
      }
    """
    if not closes or not volumes:
        return {'is_breakout': False, 'breakout_strength_pct': 0,
                'volume_ratio': 0, 'breakout_close': 0}
    
    last_close = closes[-1]
    last_vol = volumes[-1]
    base_high = base.get('base_high', 0)
    
    if base_high <= 0 or len(volumes) < 20:
        return {'is_breakout': False, 'breakout_strength_pct': 0,
                'volume_ratio': 0, 'breakout_close': last_close}
    
    vol_ma = sum(volumes[-20:]) / 20
    volume_ratio = last_vol / vol_ma if vol_ma > 0 else 0
    
    is_breakout = (last_close > base_high and volume_ratio >= volume_threshold)
    strength = ((last_close - base_high) / base_high * 100) if base_high > 0 else 0
    
    return {
        'is_breakout': is_breakout,
        'breakout_strength_pct': round(strength, 2),
        'volume_ratio': round(volume_ratio, 2),
        'breakout_close': last_close,
    }


# ═══════════════════════════════════════════════════════════════════════
# 3. Volume Accumulation (التراكم الصامت)
# ═══════════════════════════════════════════════════════════════════════

def detect_volume_accumulation(volumes: List[float], period: int = 20) -> Dict[str, Any]:
    """
    كشف تراكم السيولة (Volume Accumulation).
    
    Accumulation = الحجم بـ يزيد تدريجياً خلال الـ 20 يوم الماضيين.
    
    Returns:
      {
        'is_accumulating': bool,
        'vol_trend': 'rising'|'falling'|'flat',
        'vol_change_pct': float,
      }
    """
    n = len(volumes)
    if n < period:
        return {'is_accumulating': False, 'vol_trend': 'flat', 'vol_change_pct': 0}
    
    window = volumes[-period:]
    first_half = window[:period//2]
    second_half = window[period//2:]
    
    avg_first = sum(first_half) / len(first_half) if first_half else 0
    avg_second = sum(second_half) / len(second_half) if second_half else 0
    
    if avg_first <= 0:
        return {'is_accumulating': False, 'vol_trend': 'flat', 'vol_change_pct': 0}
    
    change_pct = ((avg_second - avg_first) / avg_first) * 100
    
    if change_pct > 10:
        trend = 'rising'
        accumulating = True
    elif change_pct < -20:
        trend = 'falling'
        accumulating = False
    else:
        trend = 'flat'
        accumulating = False
    
    return {
        'is_accumulating': accumulating,
        'vol_trend': trend,
        'vol_change_pct': round(change_pct, 2),
    }


# ═══════════════════════════════════════════════════════════════════════
# 4. Price Filters (فلاتر السعر)
# ═══════════════════════════════════════════════════════════════════════

def passes_price_filter(price: float) -> Tuple[bool, str]:
    """
    فلتر السعر — بناءً على تحليل الإنتاج:
      - <5 EGP: WR 50.5% (مسموح بس risky)
      - 5-20 EGP: WR 59.8% ← الأحسن
      - 20-50 EGP: WR 49.4% (مسموح)
      - 50-100 EGP: WR 64.3% (مسموح)
      - 100-500 EGP: WR 43.6% ← تجنب
      - >500 EGP: WR 21.1% ← ممنوع
    """
    if price > 500:
        return False, 'السعر >500 EGP (WR 21.1% في الإنتاج)'
    if price < 1:
        return False, 'السعر <1 EGP (penny stock خطير)'
    return True, f'السعر {price:.2f} EGP (في النطاق المسموح)'


# ═══════════════════════════════════════════════════════════════════════
# 5. Main Analysis — V80 Breakout Hunter
# ═══════════════════════════════════════════════════════════════════════

def analyze_breakout_opportunity(
    closes: List[float], highs: List[float], lows: List[float],
    volumes: List[float], opens: List[float]
) -> Dict[str, Any]:
    """
    المحرك الجديد — Breakout Hunter.
    
    بـ يبحث عن:
      1. Base formation (قاعدة سعرية ضيقة 20 يوم)
      2. Breakout (اختراق القاعدة بحجم)
      3. Volume accumulation (تراكم سيولة)
      4. Price filter (5-100 EGP أحسن نطاق)
    
    Returns:
      {
        'signal': 'BREAKOUT_BUY'|'WAIT'|'AVOID',
        'entry': float,
        'stop_loss': float,
        'target_1': float,
        'target_2': float,
        'confidence': int (0-100),
        'reason': str,
        'base': dict,
        'breakout': dict,
        'accumulation': dict,
      }
    """
    n = min(len(closes), len(highs), len(lows), len(volumes), len(opens))
    if n < 21:  # need at least 20 for base + 1 for breakout
        return _neutral_signal()
    
    last_close = closes[-1]
    
    # 1. Price filter
    price_ok, price_reason = passes_price_filter(last_close)
    if not price_ok:
        return {
            'signal': 'AVOID', 'entry': last_close, 'stop_loss': 0,
            'target_1': 0, 'target_2': 0, 'confidence': 0,
            'reason': price_reason, 'base': {}, 'breakout': {}, 'accumulation': {},
        }
    
    # 2. Base detection (exclude last candle — it's the breakout candidate)
    base = detect_base_formation(closes[:-1] if len(closes) > 20 else closes, 
                                  volumes[:-1] if len(volumes) > 20 else volumes,
                                  lookback=20, tightness_pct=15.0)
    
    # 3. Breakout detection (compare last close to base_high)
    breakout = detect_breakout(closes, volumes, base, volume_threshold=1.5)
    
    # 4. Volume accumulation
    accumulation = detect_volume_accumulation(volumes, period=20)
    
    # 5. ATR for stop/target
    atr = _compute_atr(highs, lows, closes, 14)
    if atr <= 0 and last_close > 0:
        atr = last_close * 0.05  # fallback 5%
    
    # 6. Decision logic
    if breakout['is_breakout'] and base['is_base']:
        # Strong signal: breakout from base + volume
        entry = last_close
        # Structural stop: under base low - 0.5×ATR
        stop_loss = base['base_low'] - (atr * 0.5)
        if stop_loss >= entry:
            stop_loss = entry - (atr * 1.5)
        
        risk = entry - stop_loss
        if risk <= 0:
            return _neutral_signal()
        
        # Targets: 2R and 4R (لا fixed target — trailing is better)
        target_1 = entry + (risk * 2.0)
        target_2 = entry + (risk * 4.0)
        
        # Confidence
        conf = 60  # base
        if accumulation['is_accumulating']:
            conf += 15
        if breakout['volume_ratio'] >= 2.0:
            conf += 10
        if breakout['breakout_strength_pct'] > 3:
            conf += 10
        if base['tightness_pct'] < 10:
            conf += 5  # tighter base = stronger
        conf = min(100, conf)
        
        reason = (f"Breakout from {base['base_days']}-day base "
                  f"(tightness={base['tightness_pct']:.1f}%) "
                  f"vol={breakout['volume_ratio']:.1f}× "
                  f"strength={breakout['breakout_strength_pct']:.1f}%")
        
        return {
            'signal': 'BREAKOUT_BUY', 'entry': entry, 'stop_loss': stop_loss,
            'target_1': target_1, 'target_2': target_2,
            'confidence': conf, 'reason': reason,
            'base': base, 'breakout': breakout, 'accumulation': accumulation,
        }
    
    elif base['is_base'] and accumulation['is_accumulating']:
        # Wait signal: base formed + accumulating, no breakout yet
        return {
            'signal': 'WAIT', 'entry': last_close, 'stop_loss': 0,
            'target_1': 0, 'target_2': 0, 'confidence': 40,
            'reason': f"Base formed ({base['base_days']}d, tight={base['tightness_pct']:.1f}%) "
                      f"+ accumulating — wait for breakout",
            'base': base, 'breakout': breakout, 'accumulation': accumulation,
        }
    
    else:
        # No setup
        return {
            'signal': 'NEUTRAL', 'entry': last_close, 'stop_loss': 0,
            'target_1': 0, 'target_2': 0, 'confidence': 20,
            'reason': f"No base/breakout setup (tight={base.get('tightness_pct',0):.1f}%)",
            'base': base, 'breakout': breakout, 'accumulation': accumulation,
        }


def _compute_atr(highs, lows, closes, period=14):
    """ATR(14)."""
    if len(closes) < 2:
        return 0
    trs = []
    for i in range(max(1, len(closes) - period), len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1])
        )
        trs.append(tr)
    return sum(trs) / len(trs) if trs else 0


def _neutral_signal():
    return {
        'signal': 'NEUTRAL', 'entry': 0, 'stop_loss': 0,
        'target_1': 0, 'target_2': 0, 'confidence': 0,
        'reason': 'بيانات غير كافية', 'base': {}, 'breakout': {}, 'accumulation': {},
    }


# ═══════════════════════════════════════════════════════════════════════
# 6. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 V80 Breakout Hunter — Self Test")
    print("=" * 60)
    
    # Test 1: Base + Breakout
    # 20 days flat (base 100-110), then breakout to 115 with volume
    closes = [100 + math.sin(i * 0.3) * 5 for i in range(20)]  # tight base
    closes.append(115)  # breakout!
    highs = [c + 1 for c in closes]
    lows = [c - 1 for c in closes]
    opens = [c - 0.5 for c in closes]
    vols = [1000] * 20 + [3000]  # volume spike on breakout
    
    result = analyze_breakout_opportunity(closes, highs, lows, vols, opens)
    print(f"\n=== Breakout Test ===")
    print(f"Signal: {result['signal']}")
    print(f"Entry: {result['entry']:.2f}")
    print(f"Stop: {result['stop_loss']:.2f}")
    print(f"Target 1: {result['target_1']:.2f}")
    print(f"Target 2: {result['target_2']:.2f}")
    print(f"Confidence: {result['confidence']}/100")
    print(f"Reason: {result['reason']}")
    
    # Test 2: No base (trending)
    closes2 = [100 + i * 2 for i in range(21)]  # steady uptrend, no base
    highs2 = [c + 1 for c in closes2]
    lows2 = [c - 1 for c in closes2]
    vols2 = [1000] * 21
    opens2 = closes2[:]
    
    result2 = analyze_breakout_opportunity(closes2, highs2, lows2, vols2, opens2)
    print(f"\n=== Trending (no base) ===")
    print(f"Signal: {result2['signal']}")
    print(f"Reason: {result2['reason']}")
    
    # Test 3: Expensive stock (>500 EGP)
    closes3 = [600 + math.sin(i * 0.1) * 5 for i in range(21)]
    highs3 = [c + 2 for c in closes3]
    lows3 = [c - 2 for c in closes3]
    vols3 = [1000] * 21
    opens3 = closes3[:]
    
    result3 = analyze_breakout_opportunity(closes3, highs3, lows3, vols3, opens3)
    print(f"\n=== Expensive stock (>500 EGP) ===")
    print(f"Signal: {result3['signal']}")
    print(f"Reason: {result3['reason']}")
    
    print("\n✅ V80 Breakout Hunter ready")

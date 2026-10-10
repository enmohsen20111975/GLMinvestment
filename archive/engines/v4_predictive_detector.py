"""
!!! ARCHIVED (PHASE-5, 2026-08-31) — V40.2 is the sole prediction engine (Rule 21) !!!
    Moved from vps-service/analyzers/v4_predictive_detector.py → archive/engines/
    Reason: Not in active production (no cron, no jobs importer). Only legacy
    backtest scripts (stage2_v4_maestro_integration.py + stage2_final_report.py)
    imported it, and they were archived alongside to preserve the cluster.
    Kept here per Rule 16 (VERIFY-BEFORE-DELETE) for history.

v4_predictive_detector.py — كاشف التنبؤ بالأسهم الانفجارية (V4)
================================================================
المرحلة 1 أثبتت أن V4 هو الأفضل:
  - Recall 74.7% (vs 29.6% القديم)
  - Precision 79.4%
  - بيكشف التجميع الهادئ BEFORE الحركة (مش أثناءها)

السر: 3 إشارات تنبؤية (مش تفاعلية):
  1. strong_accum: تصاعد حجم تدريجي + سعر شبه ثابت (15 شريطة)
  2. pre_surge: 5 شرائط أخيرة بحجم متصاعد (ramp5_ratio ≥ 1.5)
  3. compression: رينج السعر بيضيق + الحجم بيزيد (قرب breakout)

الاستخدام:
  from analyzers.v4_predictive_detector import detect_v4_predictive, is_hot_candidate

  result = detect_v4_predictive(bars)  # bars = list of dicts
  if result['is_rocket']:
      # Hot Candidate! feed to Maestro Discovery Fallback
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional


def detect_v4_predictive(bars: List[Dict[str, Any]]) -> Dict[str, Any]:
    """كاشف V4 التنبؤي — يكشف التجميع الهادئ قبل الانفجار.

    Args:
        bars: list of dicts with keys: price, volume, high, low (و timestamp اختياري)
              مرتبة زمنياً (الأقدم أولاً)

    Returns:
        {
            'is_rocket': bool,
            'score': float (0-100),
            'reason': str,
            'signals': list[str],  # ['strong_accum', 'pre_surge', 'compression']
            'vs_ratio': float,
            'details': dict,
        }
    """
    if not bars or len(bars) < 20:
        return {
            'is_rocket': False, 'score': 0.0, 'reason': 'بيانات غير كافية (< 20 شريطة)',
            'signals': [], 'vs_ratio': 0.0, 'details': {}
        }

    vols = [float(b.get('volume', 0) or 0) for b in bars]
    closes = [float(b.get('price', 0) or 0) for b in bars]
    highs = [float(b.get('high', 0) or b.get('price', 0) or 0) for b in bars]
    lows = [float(b.get('low', 0) or b.get('price', 0) or 0) for b in bars]

    # فلتر الشريطا المعطوبة
    if any(c <= 0 for c in closes[-5:]):
        return {
            'is_rocket': False, 'score': 0.0, 'reason': 'أسعار صفرية في آخر الشرائط',
            'signals': [], 'vs_ratio': 0.0, 'details': {}
        }

    lookback = min(20, len(vols) - 1)
    vol_ma = sum(vols[-lookback-1:-1]) / lookback if lookback > 0 else 0
    vs_ratio = vols[-1] / (vol_ma or 1)

    # ─── 1) Strong Quiet Accumulation ───
    # آخر 15 شريطة: السعر شبه ثابت + الحجم بيزيد تدريجياً
    strong_quiet_accum = False
    weak_quiet_accum = False
    ramp_ratio = 0.0
    price_range_pct = 0.0

    if len(closes) >= 15 and closes[-15] > 0:
        window = 15
        recent_closes = closes[-window:]
        recent_vols = vols[-window:]
        price_range_pct = (max(recent_closes) - min(recent_closes)) / recent_closes[0] * 100
        # الحجم: أول 5 vs أوسط 5 vs آخر 5
        v1 = sum(recent_vols[:5]) / 5
        v2 = sum(recent_vols[5:10]) / 5
        v3 = sum(recent_vols[10:]) / 5
        # تصاعد تدريجي: v3 > v2 > v1
        gradual_ramp = v3 > v2 > v1
        # نسبة التصاعد
        ramp_ratio = v3 / (v1 or 1) if v1 > 0 else 1
        # تجميع هادئ قوي
        strong_quiet_accum = price_range_pct <= 3.0 and gradual_ramp and ramp_ratio >= 1.8
        weak_quiet_accum = (not strong_quiet_accum) and price_range_pct <= 4.0 and ramp_ratio >= 1.4

    # ─── 2) Pre-surge ramp (تصاعد حاد في آخر 5) ───
    pre_surge = False
    ramp5_ratio = 0.0
    if len(vols) >= 6 and all(v > 0 for v in vols[-6:]):
        prev_avg = sum(vols[-10:-5]) / 5 if len(vols) >= 10 else sum(vols[-6:-5])
        last5_avg = sum(vols[-5:]) / 5
        ramp5_ratio = last5_avg / (prev_avg or 1) if prev_avg > 0 else 1
        # تصاعد مستمر (مسامح بـ 10% تذبذب)
        ramp_continuous = all(vols[-i-1] >= vols[-i-2] * 0.9 for i in range(4))
        pre_surge = ramp5_ratio >= 1.5 and ramp_continuous

    # ─── 3) Compression + Volume (قرب breakout) ───
    # رينج السعر بتضيق + الحجم بيزيد = قرب breakout
    compression_breakout = False
    if len(closes) >= 20 and closes[-20] > 0:
        early_range = (max(closes[-20:-10]) - min(closes[-20:-10])) / closes[-20] * 100
        late_range = (max(closes[-10:]) - min(closes[-10:])) / closes[-10] * 100
        # رينج بيضيق
        range_compression = late_range < early_range * 0.7
        # حجم آخر 10 > أول 10
        vol_expansion = sum(vols[-10:]) > sum(vols[-20:-10]) * 1.2
        compression_breakout = range_compression and vol_expansion

    # ─── ROC (مساعد، مش شرط أساسي) ───
    roc5 = (closes[-1] - closes[-6]) / closes[-6] * 100 if len(closes) >= 6 and closes[-6] > 0 else 0
    roc10 = (closes[-1] - closes[-11]) / closes[-11] * 100 if len(closes) >= 11 and closes[-11] > 0 else 0
    roc20 = (closes[-1] - closes[-21]) / closes[-21] * 100 if len(closes) >= 21 and closes[-21] > 0 else 0

    # ─── احتساب النقاط ───
    score = 0
    signals = []
    reasons = []

    if strong_quiet_accum:
        score += 35
        signals.append('strong_accum')
        reasons.append(f'strong_accum ramp={ramp_ratio:.1f}x range={price_range_pct:.1f}%')
    elif weak_quiet_accum:
        score += 20
        signals.append('weak_accum')
        reasons.append(f'weak_accum ramp={ramp_ratio:.1f}x')

    if pre_surge:
        score += 25
        signals.append('pre_surge')
        reasons.append(f'pre_surge ramp5={ramp5_ratio:.1f}x')

    if compression_breakout:
        score += 20
        signals.append('compression')
        reasons.append('compression+vol_expansion')

    # ROC بسيط (مساعد)
    if roc5 > 1:
        score += 5
        reasons.append(f'ROC5={roc5:+.1f}%')
    if roc10 > 3:
        score += 8
        reasons.append(f'ROC10={roc10:+.1f}%')
    if roc20 > 5:
        score += 7
        reasons.append(f'ROC20={roc20:+.1f}%')

    # ─── قرار الإشارة ───
    # لازم يكون فيه تجميع أو pre-surge (مش مجرد حجم عالي)
    has_predictive_signal = (
        'strong_accum' in signals or
        'weak_accum' in signals or
        'pre_surge' in signals or
        'compression' in signals
    )
    is_rocket = score >= 40 and has_predictive_signal

    return {
        'is_rocket': is_rocket,
        'score': min(score, 100),
        'reason': ' | '.join(reasons),
        'signals': signals,
        'vs_ratio': vs_ratio,
        'details': {
            'strong_quiet_accum': strong_quiet_accum,
            'weak_quiet_accum': weak_quiet_accum,
            'pre_surge': pre_surge,
            'compression_breakout': compression_breakout,
            'ramp_ratio': ramp_ratio,
            'ramp5_ratio': ramp5_ratio,
            'price_range_pct': price_range_pct,
            'roc5': roc5, 'roc10': roc10, 'roc20': roc20,
        }
    }


def is_hot_candidate(bars: List[Dict[str, Any]], min_score: float = 50.0) -> Dict[str, Any]:
    """فحص مبسّط: هل السهم Hot Candidate؟

    يستخدم في Maestro Discovery Fallback كـ Layer 0.
    عتبة أعلى شوية (50) عشان نفلتر الإشارات الضعيفة.

    Returns:
        {
            'is_hot': bool,
            'score': float,
            'reason': str,
            'should_maker_override': bool,  # لو score ≥ 65 → Maker Override
            'recommended_risk_pct': float,  # 0.5-0.7% (مخاطرة مخفّضة)
        }
    """
    result = detect_v4_predictive(bars)
    if not result['is_rocket']:
        return {
            'is_hot': False, 'score': 0, 'reason': '',
            'should_maker_override': False, 'recommended_risk_pct': 0
        }

    score = result['score']
    # Hot Candidate لو score ≥ 50 (عتبة أعلى من الـ 40 الأساسية)
    is_hot = score >= min_score
    # Maker Override لو score ≥ 65 (قوي جداً)
    should_maker_override = score >= 65
    # مخاطرة مخفّضة: 0.5% للـ hot العادي، 0.7% للـ maker override
    recommended_risk_pct = 0.7 if should_maker_override else 0.5

    return {
        'is_hot': is_hot,
        'score': score,
        'reason': result['reason'],
        'signals': result['signals'],
        'should_maker_override': should_maker_override,
        'recommended_risk_pct': recommended_risk_pct,
        'details': result['details'],
    }


def detect_v4_from_ohlcv(ohlcv: List[Dict[str, float]]) -> Dict[str, Any]:
    """Wrapper لـ detect_v4_predictive يقبل OHLCV format (زي core_scoring_engine).

    Args:
        ohlcv: list of dicts with keys: close, high, low, open, volume

    Returns:
        نفس output detect_v4_predictive بس بـ keys متوافقة مع core_scoring_engine
        (is_rocket, score, reason, entry, target, stop, details)
    """
    bars = []
    for c in ohlcv:
        bars.append({
            'price': float(c.get('close', 0) or 0),
            'high': float(c.get('high', 0) or 0),
            'low': float(c.get('low', 0) or 0),
            'volume': float(c.get('volume', 0) or 0),
        })

    result = detect_v4_predictive(bars)
    if not result['is_rocket']:
        return {
            'is_rocket': False, 'score': 0.0, 'reason': result['reason'],
            'entry': 0, 'target': 0, 'stop': 0, 'details': result.get('details', {})
        }

    # ATR-based target/stop (نفس معادلة V1)
    closes = [b['price'] for b in bars]
    highs = [b['high'] for b in bars]
    lows = [b['low'] for b in bars]
    if len(closes) >= 15:
        trs = []
        for i in range(-14, 0):
            if i - 1 >= -len(closes):
                tr = max(highs[i] - lows[i],
                         abs(highs[i] - closes[i-1]),
                         abs(lows[i] - closes[i-1]))
                trs.append(tr)
        atr_val = sum(trs) / len(trs) if trs else 0
    else:
        atr_val = 0

    entry = closes[-1]
    target = entry + (atr_val * 3.0)  # 3R target
    stop = entry - (atr_val * 1.5)    # 1.5R stop → R:R = 2.0

    return {
        'is_rocket': True,
        'score': result['score'],
        'reason': result['reason'],
        'entry': entry,
        'target': target,
        'stop': stop,
        'details': result['details'],
        'signals': result['signals'],
    }


def normalize_intraday_bars(raw_bars: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """حوّل شرائط intraday (volume تراكمي) لـ per-bar volume.

    مشكلة البيانات: volume تراكمي + reset عند تبديل الجلسة.
    الحل: delta_volume = cur_vol - prev_vol (لو موجب)، 0 لو سالب (reset).
    """
    if not raw_bars:
        return []
    normalized = []
    prev_vol = None
    for b in raw_bars:
        cur_vol = float(b.get('volume', 0) or 0)
        if prev_vol is None:
            delta_vol = cur_vol
        elif cur_vol >= prev_vol:
            delta_vol = cur_vol - prev_vol
        else:
            # reset — الجلسة اتغيرت
            delta_vol = cur_vol
        prev_vol = cur_vol
        normalized.append({
            'timestamp': b.get('timestamp', ''),
            'price': float(b.get('price', 0) or 0),
            'volume': delta_vol,  # per-bar volume
            'high': float(b.get('high', 0) or b.get('price', 0) or 0),
            'low': float(b.get('low', 0) or b.get('price', 0) or 0),
            'cumulative_volume': cur_vol,  # للحفاظ على الأصلي
        })
    return normalized


if __name__ == '__main__':
    # اختبار سريع
    import os
    import sqlite3
    from pathlib import Path as _P
    _project_root = _P(__file__).resolve().parents[2]
    _intraday_path = str(_project_root / 'db' / 'intraday.db')
    if not os.path.exists(_intraday_path):
        # honor LOG_DIR / DB_DIR overrides (Rule 61)
        _intraday_path = os.path.join(
            os.environ.get('LOG_DIR', '/tmp'), 'intraday.db'
        )
    conn = sqlite3.connect(_intraday_path)

    for ticker in ['NIPH', 'GTWL']:
        rows = conn.execute("""
            SELECT timestamp, price, volume, high, low
            FROM stock_intraday
            WHERE market='مصر' AND ticker=? AND substr(timestamp,1,10)='2026-08-16'
            ORDER BY timestamp
        """, (ticker,)).fetchall()
        raw_bars = [{'timestamp': r[0], 'price': r[1], 'volume': r[2],
                     'high': r[3] or r[1], 'low': r[4] or r[1]} for r in rows]
        bars = normalize_intraday_bars(raw_bars)

        print(f"\n{ticker} @ 2026-08-16: {len(bars)} bars")
        print(f"First price: {bars[0]['price']}, Last price: {bars[-1]['price']}")
        print(f"Change: {(bars[-1]['price'] - bars[0]['price']) / bars[0]['price'] * 100:+.1f}%")

        # امسح من شريطة 20 لحد النهاية
        first_signal = None
        for i in range(20, len(bars) - 1):
            window = bars[:i+1]
            result = detect_v4_predictive(window)
            if result['is_rocket']:
                cur_price = bars[i]['price']
                pct = (cur_price - bars[0]['price']) / bars[0]['price'] * 100
                if first_signal is None:
                    first_signal = (i, bars[i]['timestamp'], cur_price, pct, result)
                print(f"  Signal @ bar {i} ({bars[i]['timestamp'][11:19]}): "
                      f"price={cur_price:.2f} (+{pct:.1f}%) score={result['score']:.0f} "
                      f"signals={result['signals']}")

        if first_signal is None:
            print(f"  (لا إشارة)")
    conn.close()

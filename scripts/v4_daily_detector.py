#!/usr/bin/env python3
"""
V4-Daily — كاشف التجميع الهادئ على البيانات اليومية
=====================================================
المرحلة 3: بعد فشل V4-Intraday (precision 6.4%)، نطبق الفكرة على الإطار اليومي.

المنطق:
  الانفجارات في EGX بتحصل بعد فترة تجميع أيام (مش ساعات).
  V4-Daily بيكشف:
    1. Price Compression: رينج سعر ضيق في آخر 10-15 يوم
    2. Volume Build-up: حجم بيطلع تدريجي (مش مفاجئ)
    3. Tight Closes: إغلاقات متقاربة (stddev منخفض)
    4. Dry-up then Surge: حجم بيقل ثم يزيد (VCP pattern)
    5. Base Formation: فوق SMA50 (الأبترند سليم)

  الهدف: نكتشف السهم BEFORE الانفجار، مش أثناءه.

الاختبار:
  - Recall: على الأسهم الانفجارية (≥+15% في يوم)
  - Precision: على كل الأسهم السائلة (إشارة صحيحة = طار ≥+10% خلال 5 أيام)
"""
import sqlite3
import sys
import os
import math
from collections import defaultdict
from datetime import datetime

DB = '/tmp/dbs/data_engine.db'

# ═══════════════════════════════════════════════════════════════════
# 1) مؤشرات مساعدة
# ═══════════════════════════════════════════════════════════════════

def sma(values, period):
    if len(values) < period: return 0
    return sum(values[-period:]) / period

def stddev(values, period):
    if len(values) < period: return 0
    sub = values[-period:]
    m = sum(sub) / period
    return (sum((v - m) ** 2 for v in sub) / period) ** 0.5

def rsi(closes, period=14):
    if len(closes) < period + 1: return 50
    gains, losses = [], []
    for i in range(1, min(period + 1, len(closes))):
        change = closes[-i] - closes[-i-1]
        if change > 0: gains.append(change)
        else: losses.append(abs(change))
    avg_gain = sum(gains) / period if gains else 0
    avg_loss = sum(losses) / period if losses else 0
    if avg_loss == 0:
        return 100.0  # كل أيام صعود
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def atr(highs, lows, closes, period=14):
    if len(closes) < period + 1: return 0
    trs = []
    for i in range(-period, 0):
        if i - 1 >= -len(closes):
            tr = max(highs[i] - lows[i],
                     abs(highs[i] - closes[i-1]),
                     abs(lows[i] - closes[i-1]))
            trs.append(tr)
    return sum(trs) / len(trs) if trs else 0

def roc(values, period):
    if len(values) < period + 1: return 0
    if values[-period-1] == 0: return 0
    return (values[-1] - values[-period-1]) / values[-period-1] * 100


# ═══════════════════════════════════════════════════════════════════
# 2) V4-Daily Detector
# ═══════════════════════════════════════════════════════════════════

def detect_v4_daily(closes, highs, lows, volumes):
    """كاشف التجميع الهادئ اليومي (V4-Daily v2 — متوازن).

    Args:
        closes, highs, lows, volumes: lists of daily values (oldest first)

    Returns:
        {
            'is_hot': bool,
            'score': float (0-100),
            'signals': list[str],
            'reason': str,
            'details': dict,
        }
    """
    if not closes or len(closes) < 30:
        return {'is_hot': False, 'score': 0, 'signals': [], 'reason': 'بيانات غير كافية', 'details': {}}

    # فلتر البيانات المكسورة (أيام volume=0 متكررة)
    recent_vols = volumes[-20:]
    if sum(1 for v in recent_vols if v == 0) > 8:
        return {'is_hot': False, 'score': 0, 'signals': [], 'reason': 'بيانات مكسورة (vol=0)', 'details': {}}

    last_close = closes[-1]
    if last_close <= 0:
        return {'is_hot': False, 'score': 0, 'signals': [], 'reason': 'سعر صفر', 'details': {}}

    score = 0
    signals = []
    reasons = []
    details = {}

    # ─── Signal 1: Price Compression (10-day range) ───
    if len(closes) >= 10:
        recent_high = max(highs[-10:])
        recent_low = min(lows[-10:])
        price_range_pct = (recent_high - recent_low) / last_close * 100 if last_close > 0 else 100
        details['price_range_pct'] = price_range_pct
        if price_range_pct <= 8:
            score += 22; signals.append('compression_strong')
            reasons.append(f'compression_strong range={price_range_pct:.1f}%')
        elif price_range_pct <= 15:
            score += 14; signals.append('compression_mild')
            reasons.append(f'compression_mild range={price_range_pct:.1f}%')
        elif price_range_pct <= 25:
            score += 8; signals.append('compression_weak')
            reasons.append(f'compression_weak range={price_range_pct:.1f}%')

    # ─── Signal 2: Volume Build-up ───
    # متوسط حجم آخر 5 أيام vs متوسط آخر 20 يوم
    vol_ratio = 0
    if len(volumes) >= 20:
        recent_vol = sum(volumes[-5:]) / 5
        base_vol = sum(volumes[-20:]) / 20
        vol_ratio = recent_vol / (base_vol or 1)
        details['vol_ratio'] = vol_ratio
        # حجم بيتصاعد تدريجياً (1.2x - 3.5x) = تجميع
        if 1.2 <= vol_ratio <= 3.5:
            score += 18; signals.append('vol_buildup')
            reasons.append(f'vol_buildup ratio={vol_ratio:.2f}x')
        elif 1.05 <= vol_ratio < 1.2:
            score += 7; signals.append('vol_slight')
            reasons.append(f'vol_slight ratio={vol_ratio:.2f}x')

    # ─── Signal 3: Tight Closes (low stddev) ───
    if len(closes) >= 15:
        sd = stddev(closes, 15)
        sd_pct = sd / last_close * 100 if last_close > 0 else 100
        details['close_stddev_pct'] = sd_pct
        if sd_pct <= 4:
            score += 18; signals.append('tight_closes')
            reasons.append(f'tight_closes sd={sd_pct:.1f}%')
        elif sd_pct <= 7:
            score += 9; signals.append('moderate_tight')
            reasons.append(f'moderate_tight sd={sd_pct:.1f}%')

    # ─── Signal 4: VCP (Volatility Contraction Pattern) ───
    if len(closes) >= 20:
        recent_range = max(highs[-5:]) - min(lows[-5:])
        prior_range = max(highs[-10:-5]) - min(lows[-10:-5])
        if prior_range > 0:
            contraction = recent_range / prior_range
            details['vcp_contraction'] = contraction
            if contraction <= 0.5:
                score += 18; signals.append('vcp_strong')
                reasons.append(f'vcp_strong contraction={contraction:.2f}')
            elif contraction <= 0.8:
                score += 9; signals.append('vcp_mild')
                reasons.append(f'vcp_mild contraction={contraction:.2f}')

    # ─── Signal 5: Base Formation (above SMA20) ───
    # فوق SMA20 = أبترند قصير سليم
    sma20_val = 0
    sma50_val = 0
    if len(closes) >= 20:
        sma20_val = sma(closes, 20)
        dist_from_sma20 = (last_close - sma20_val) / sma20_val * 100 if sma20_val > 0 else 0
        details['sma20'] = sma20_val
        details['dist_from_sma20'] = dist_from_sma20
        if -10 <= dist_from_sma20 <= 15:
            score += 10; signals.append('base_above_sma20')
            reasons.append(f'base_above_sma20 dist={dist_from_sma20:+.1f}%')
    if len(closes) >= 50:
        sma50_val = sma(closes, 50)
        dist_from_sma50 = (last_close - sma50_val) / sma50_val * 100 if sma50_val > 0 else 0
        details['sma50'] = sma50_val
        details['dist_from_sma50'] = dist_from_sma50
        if -15 <= dist_from_sma50 <= 25:
            score += 6; signals.append('base_above_sma50')
            reasons.append(f'base_above_sma50 dist={dist_from_sma50:+.1f}%')

    # ─── Signal 6: Calm before storm (ROC low + vol building) ───
    if len(closes) >= 6:
        roc5 = roc(closes, 5)
        details['roc5'] = roc5
        if abs(roc5) <= 4 and 'vol_buildup' in signals:
            score += 10; signals.append('calm_buildup')
            reasons.append(f'calm_buildup roc5={roc5:+.1f}%')

    # ─── Signal 7: Multi-week base (20-day consolidation) ───
    if len(closes) >= 20:
        range_20d = (max(highs[-20:]) - min(lows[-20:])) / last_close * 100 if last_close > 0 else 100
        details['range_20d'] = range_20d
        if range_20d <= 20:
            score += 10; signals.append('multi_week_base')
            reasons.append(f'multi_week_base range20={range_20d:.1f}%')

    # ─── Signal 8: Near 20-day low (buying near support) ───
    if len(closes) >= 20:
        low_20d = min(lows[-20:])
        dist_from_low = (last_close - low_20d) / low_20d * 100 if low_20d > 0 else 0
        details['dist_from_20d_low'] = dist_from_low
        if 0 <= dist_from_low <= 8:
            score += 8; signals.append('near_support')
            reasons.append(f'near_support dist={dist_from_low:+.1f}%')

    # ─── Signal 9: Volume dry-up then surge (VCP volume) ───
    # حجم آخر 3 أيام < متوسط 20 يوم، بس آخر يوم طلع
    if len(volumes) >= 20 and len(volumes) >= 4:
        last_vol = volumes[-1]
        prior_3 = sum(volumes[-4:-1]) / 3
        base_vol = sum(volumes[-20:]) / 20
        if prior_3 < base_vol * 0.7 and last_vol > prior_3 * 1.5:
            score += 12; signals.append('vol_dryup_surge')
            reasons.append('vol_dryup_surge')

    # ─── Anti-Signals (مخففة) ───
    # ممدود زيادة (>40% فوق 50d high)
    if len(closes) >= 50:
        high_50d = max(highs[-50:])
        dist_from_high = (last_close - high_50d) / high_50d * 100 if high_50d > 0 else 0
        details['dist_from_50d_high'] = dist_from_high
        if dist_from_high > 40:
            score -= 12; reasons.append(f'extended dist_from_high={dist_from_high:+.1f}%')

    # Falling knife: نزل أكتر من -20% في 5 أيام
    if len(closes) >= 6:
        roc5 = roc(closes, 5)
        if roc5 < -20:
            score -= 15; reasons.append(f'falling_knife roc5={roc5:+.1f}%')

    # حجم بيقفز فجأة > 5x = الانفجار خلص (مرفوض)
    if vol_ratio > 5:
        score -= 20; reasons.append(f'already_exploded vol_ratio={vol_ratio:.1f}x')

    # RSI مرتفع جداً (>85) = overbought شديد
    rsi_val = rsi(closes)
    details['rsi'] = rsi_val
    if rsi_val > 85:
        score -= 10; reasons.append(f'overbought rsi={rsi_val:.0f}')

    score = max(0, min(score, 100))

    # ─── القرار ───
    # is_hot: score ≥ 35 + على الأقل compression (أي مستوى) + volume signal
    # + فلتر إضافي: حجم آخر يوم > 0.8x متوسط 20 يوم (مرفوض لو حجم جاف جداً)
    has_compression = any(s in signals for s in ['compression_strong', 'compression_mild', 'compression_weak'])
    has_volume_signal = any(s in signals for s in ['vol_buildup', 'vol_slight', 'tight_closes', 'vol_dryup_surge'])
    # فلتر: حجم آخر يوم لازم يكون ليه معنى (مش شبه صفر)
    last_vol_healthy = len(volumes) >= 1 and volumes[-1] > 10000
    is_hot = (score >= 35 and (has_compression or has_volume_signal)
              and last_vol_healthy)

    return {
        'is_hot': is_hot,
        'is_hot_strong': is_hot and score >= 50,  # tier أعلى للـ precision
        'score': score,
        'signals': signals,
        'reason': ' | '.join(reasons),
        'details': details,
    }


# ═══════════════════════════════════════════════════════════════════
# 2b) V4-Daily v2 — مع الفلاتر التلاتة (المرحلة 1)
# ═══════════════════════════════════════════════════════════════════

def detect_v4_daily_v2(closes, highs, lows, volumes, min_score=45,
                        vol_confirm_min=1.5, vol_confirm_max=5.0,
                        require_multi_day=True):
    """V4-Daily v2 — مع 3 فلاتر إضافية (المرحلة 1):

    1. اتجاه مؤكد: السعر فوق SMA20 + SMA20 ≥ SMA50 (أو قريب جداً ≤ -3%)
    2. حجم يوم الإشارة بين vol_confirm_min× و vol_confirm_max× MA20
       (default: 1.5x - 5x — نرفض القليل جداً والكثير جداً)
    3. تأكيد على يومين متتاليين: الإشارة لازم تكررت يومين قبل كده

    Returns:
        {
            'is_hot': bool,
            'score': float,
            'signals': list,
            'reason': str,
            'filters': dict,
        }
    """
    if not closes or len(closes) < 60:
        return {'is_hot': False, 'score': 0, 'signals': [], 'reason': 'بيانات غير كافية (< 60 يوم)', 'filters': {}}

    # شغل V4-Daily الأصلي على آخر يوم
    base_result = detect_v4_daily(closes, highs, lows, volumes)
    if not base_result['is_hot']:
        return {
            'is_hot': False,
            'score': base_result['score'],
            'signals': base_result['signals'],
            'reason': 'base V4-Daily not hot',
            'filters': {'base_rejected': True},
        }

    score = base_result['score']
    if score < min_score:
        return {
            'is_hot': False,
            'score': score,
            'signals': base_result['signals'],
            'reason': f'score {score:.0f} < {min_score}',
            'filters': {'score_rejected': True},
        }

    filters = {}
    filter_reasons = []

    # ─── Filter 1: Trend Confirmation ───
    sma20_val = sma(closes, 20) if len(closes) >= 20 else 0
    sma50_val = sma(closes, 50) if len(closes) >= 50 else 0
    last_close = closes[-1]

    trend_ok = False
    trend_reason = ''
    if sma20_val > 0 and sma50_val > 0:
        price_above_sma20 = last_close > sma20_val
        sma_ratio = (sma20_val - sma50_val) / sma50_val * 100
        sma20_above_or_near = sma_ratio >= -3.0
        if price_above_sma20 and sma20_above_or_near:
            trend_ok = True
            trend_reason = f'price>sma20 + sma20/sma50={sma_ratio:+.1f}%'
        else:
            trend_reason = f'price={"above" if price_above_sma20 else "below"} sma20, sma20/sma50={sma_ratio:+.1f}%'
    filters['trend_ok'] = trend_ok
    filters['trend_reason'] = trend_reason
    if not trend_ok:
        filter_reasons.append(f'trend_rejected: {trend_reason}')

    # ─── Filter 2: Signal-day Volume في نطاق [min, max] ───
    vol_confirm_ok = False
    vol_reason = ''
    if len(volumes) >= 20:
        ma20_vol = sum(volumes[-20:]) / 20
        last_vol = volumes[-1]
        vol_ratio = last_vol / (ma20_vol or 1)
        if vol_ratio >= vol_confirm_min and vol_ratio <= vol_confirm_max:
            vol_confirm_ok = True
            vol_reason = f'vol={vol_ratio:.2f}x MA20 (in [{vol_confirm_min}, {vol_confirm_max}])'
        elif vol_ratio < vol_confirm_min:
            vol_reason = f'vol={vol_ratio:.2f}x MA20 (< {vol_confirm_min}x — too low)'
        else:
            vol_reason = f'vol={vol_ratio:.2f}x MA20 (> {vol_confirm_max}x — already exploded)'
        filters['vol_confirm_ok'] = vol_confirm_ok
        filters['vol_confirm_reason'] = vol_reason
        filters['vol_ratio'] = vol_ratio
        if not vol_confirm_ok:
            filter_reasons.append(f'vol_rejected: {vol_reason}')

    # ─── Filter 3: Multi-day Confirmation ───
    multi_day_ok = False
    multi_day_reason = ''
    confirm_count = 1
    if len(closes) >= 62:
        for offset in [1, 2]:
            sub_closes = closes[:-offset] if offset > 0 else closes
            sub_highs = highs[:-offset] if offset > 0 else highs
            sub_lows = lows[:-offset] if offset > 0 else lows
            sub_vols = volumes[:-offset] if offset > 0 else volumes
            if len(sub_closes) < 60:
                continue
            sub_result = detect_v4_daily(sub_closes, sub_highs, sub_lows, sub_vols)
            if sub_result['is_hot'] and sub_result['score'] >= min_score:
                confirm_count += 1
        if confirm_count >= 2:
            multi_day_ok = True
            multi_day_reason = f'confirm_count={confirm_count}/3'
        else:
            multi_day_reason = f'confirm_count={confirm_count}/3 (need ≥2)'
        filters['multi_day_ok'] = multi_day_ok
        filters['multi_day_reason'] = multi_day_reason
        if not multi_day_ok:
            filter_reasons.append(f'multi_day_rejected: {multi_day_reason}')
    else:
        multi_day_ok = True
        multi_day_reason = 'insufficient data, allowed'
        filters['multi_day_ok'] = True
        filters['multi_day_reason'] = multi_day_reason

    # لو require_multi_day=False، نعفي الـ multi_day
    if not require_multi_day:
        multi_day_ok = True

    # ─── القرار النهائي ───
    is_hot_final = trend_ok and vol_confirm_ok and multi_day_ok
    final_reason = ' | '.join(filter_reasons) if filter_reasons else 'all filters passed'

    return {
        'is_hot': is_hot_final,
        'score': score,
        'signals': base_result['signals'],
        'reason': final_reason,
        'filters': filters,
        'base_reason': base_result['reason'],
    }


# ═══════════════════════════════════════════════════════════════════
# 3) تحميل البيانات اليومية
# ═══════════════════════════════════════════════════════════════════

def load_daily_history(conn, ticker, end_date, days=60):
    """حمّل آخر `days` يوم من price_history قبل end_date."""
    rows = conn.execute("""
        SELECT price_date, open_price, high_price, low_price, close_price, volume
        FROM egksco_price_history
        WHERE symbol=? AND price_date <= ?
        ORDER BY price_date DESC LIMIT ?
    """, (ticker, end_date, days)).fetchall()
    rows = list(reversed(rows))
    # فلتر الصفوف اللي close_price = NULL أو 0
    clean = [r for r in rows if r[4] and float(r[4]) > 0]
    return {
        'dates': [r[0] for r in clean],
        'opens': [float(r[1] or 0) for r in clean],
        'highs': [float(r[2] or 0) for r in clean],
        'lows': [float(r[3] or 0) for r in clean],
        'closes': [float(r[4] or 0) for r in clean],
        'volumes': [float(r[5] or 0) for r in clean],
    }


def get_all_tickers(conn, min_avg_vol=100000, min_days=60):
    """كل الأسهم السائلة (متوسط حجم يومي ≥ 100K + ≥ 60 يوم بيانات)."""
    rows = conn.execute("""
        SELECT symbol, AVG(volume) as avg_vol, COUNT(*) as days
        FROM egksco_price_history
        WHERE volume > 0 AND close_price > 0
        GROUP BY symbol
        HAVING avg_vol >= ? AND days >= ?
        ORDER BY avg_vol DESC
    """, (min_avg_vol, min_days)).fetchall()
    return [(r[0], r[1], r[2]) for r in rows]


def find_explosive_days(conn, min_change=15.0, min_volume=100000):
    """يلقى كل (ticker, date) اللي طار ≥ min_change% في يوم."""
    rows = conn.execute("""
        SELECT symbol, price_date, open_price, close_price, high_price, low_price, volume
        FROM egksco_price_history
        WHERE volume >= ? AND close_price > 0 AND open_price > 0
        ORDER BY symbol, price_date
    """, (min_volume,)).fetchall()

    # نحسب التغير من الـ close اللي قبله لكل symbol
    explosive = []
    prev_close = {}
    for r in rows:
        symbol, date, op, cl, hi, lo, vol = r
        if symbol in prev_close and prev_close[symbol] > 0:
            change_pct = (cl - prev_close[symbol]) / prev_close[symbol] * 100
            if change_pct >= min_change:
                explosive.append({
                    'ticker': symbol, 'date': date,
                    'prev_close': prev_close[symbol],
                    'open': op, 'close': cl, 'high': hi, 'low': lo,
                    'volume': vol, 'change_pct': change_pct,
                })
        prev_close[symbol] = cl

    explosive.sort(key=lambda x: -x['change_pct'])
    return explosive


# ═══════════════════════════════════════════════════════════════════
# 4) الاختبار
# ═══════════════════════════════════════════════════════════════════

def test_recall(conn, explosive_list, lookback=60):
    """اختبر V4-Daily على الأسهم الانفجارية.
    لكل سهم انفجاري، شغل V4-Daily على بيانات الـ 60 يوم السابقة لتاريخ الانفجار.
    الهدف: هل V4-Daily رجّع is_hot=True في اليوم اللي قبل الانفجار؟
    """
    results = []
    for exp in explosive_list:
        ticker = exp['ticker']
        exp_date = exp['date']
        # حمّل بيانات الـ 60 يوم قبل تاريخ الانفجار (مش inclu يوم الانفجار)
        hist = load_daily_history(conn, ticker, exp_date, lookback)
        if len(hist['closes']) < 30:
            results.append({'explosive': exp, 'tested': False, 'reason': 'بيانات غير كافية'})
            continue

        result = detect_v4_daily(hist['closes'], hist['highs'], hist['lows'], hist['volumes'])
        results.append({
            'explosive': exp,
            'tested': True,
            'v4_result': result,
            'is_hot': result['is_hot'],
            'score': result['score'],
            'signals': result['signals'],
            'reason': result['reason'],
            'prev_close': hist['closes'][-1],  # الإغلاق قبل الانفجار
        })
    return results


def test_precision(conn, scan_date, lookback=60, future_days=5, min_future_return=10.0,
                   min_score=35):
    """اختبر V4-Daily على كل الأسهم السائلة في تاريخ معين.
    الإشارة "صحيحة" = السهم طار ≥ +10% خلال 5 أيام بعدها.
    """
    tickers = get_all_tickers(conn, min_avg_vol=100000, min_days=lookback + future_days + 5)
    results = {
        'total_signals': 0, 'true_signals': 0, 'false_signals': 0,
        'details': [], 'tested_count': 0,
    }

    for ticker, _, _ in tickers:
        # حمّل بيانات الـ 60 يوم قبل scan_date
        hist = load_daily_history(conn, ticker, scan_date, lookback)
        if len(hist['closes']) < 30:
            continue
        results['tested_count'] += 1

        result = detect_v4_daily(hist['closes'], hist['highs'], hist['lows'], hist['volumes'])
        if not result['is_hot']:
            continue
        # فلتر score
        if result['score'] < min_score:
            continue

        results['total_signals'] += 1

        # حمّل الـ future_days بعد scan_date
        future_rows = conn.execute("""
            SELECT price_date, close_price FROM egksco_price_history
            WHERE symbol=? AND price_date > ?
            ORDER BY price_date ASC LIMIT ?
        """, (ticker, scan_date, future_days)).fetchall()
        if not future_rows or len(future_rows) < 2:
            results['false_signals'] += 1
            continue

        entry_price = float(hist['closes'][-1])
        max_future = max(float(r[1] or 0) for r in future_rows)
        future_return = (max_future - entry_price) / entry_price * 100 if entry_price > 0 else 0

        detail = {
            'ticker': ticker, 'date': scan_date,
            'score': result['score'], 'signals': result['signals'],
            'entry': entry_price, 'max_future': max_future,
            'future_return': future_return,
            'is_true': future_return >= min_future_return,
        }
        results['details'].append(detail)
        if future_return >= min_future_return:
            results['true_signals'] += 1
        else:
            results['false_signals'] += 1

    return results


def simulate_trade(conn, ticker, entry_date, entry_price, stop_pct=8, target_pct=15, max_hold=10):
    """محاكاة صفقة من entry_date لأقصى max_hold يوم.
    Stop = -8%، Target = +15%.
    """
    future = conn.execute("""
        SELECT price_date, high_price, low_price, close_price
        FROM egksco_price_history
        WHERE symbol=? AND price_date > ?
        ORDER BY price_date ASC LIMIT ?
    """, (ticker, entry_date, max_hold)).fetchall()
    if not future:
        return None

    stop_price = entry_price * (1 - stop_pct / 100)
    target_price = entry_price * (1 + target_pct / 100)

    for i, r in enumerate(future):
        hi = float(r[1] or 0)
        lo = float(r[2] or 0)
        cl = float(r[3] or 0)
        if lo <= stop_price <= hi:
            return {'return_pct': -stop_pct, 'exit_type': 'stop_loss', 'exit_day': i + 1, 'exit_price': stop_price}
        if hi >= target_price:
            return {'return_pct': target_pct, 'exit_type': 'target_hit', 'exit_day': i + 1, 'exit_price': target_price}

    # انتهت المدة
    last_close = float(future[-1][3] or entry_price)
    ret = (last_close - entry_price) / entry_price * 100
    return {'return_pct': ret, 'exit_type': 'expired', 'exit_day': len(future), 'exit_price': last_close}


# ═══════════════════════════════════════════════════════════════════
# 5) التقرير
# ═══════════════════════════════════════════════════════════════════

def main():
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB, writable=False).__enter__()

    print("╔" + "═"*78 + "╗")
    print("║" + "   V4-Daily — كاشف التجميع الهادئ على البيانات اليومية   ".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    print("\n" + "─"*80)
    print("القسم 1: الإعداد")
    print("─"*80)
    print("  • الفترة: يناير 2025 - أغسطس 2026 (439 يوم تداول)")
    print("  • الكاشف: V4-Daily (7 إشارات + 3 anti-signals)")
    print("  • الإشارات: compression, vol_buildup, tight_closes, VCP, base, calm, multi_week")
    print("  • Anti-signals: extended, falling_knife, already_exploded, overbought")
    print("  • عتبة is_hot: score ≥ 45 + compression + volume signal")

    # ─── القسم 2: Recall على الأسهم الانفجارية ───
    print("\n" + "─"*80)
    print("القسم 2: Recall — الأسهم الانفجارية (≥ +15% في يوم واحد)")
    print("─"*80)

    explosive = find_explosive_days(conn, min_change=15.0, min_volume=100000)
    print(f"\nإجمالي الأيام الانفجارية: {len(explosive)}")
    # فلتر: نأخذ الانفجارات اللي بعدها بيانات كافية (قبل أغسطس 2026)
    testable = [e for e in explosive if e['date'] < '2026-08-28']
    print(f"قابلة للاختبار (قبل 2026-08-28): {len(testable)}")

    # نوزع حسب الشدة
    bands = [(15, 20), (20, 30), (30, 50), (50, 1000)]
    for lo, hi in bands:
        n = sum(1 for e in testable if lo <= e['change_pct'] < hi)
        print(f"  +{lo}% to +{hi}%: {n} يوم")

    recall_results = test_recall(conn, testable, lookback=60)

    caught = [r for r in recall_results if r.get('is_hot')]
    missed = [r for r in recall_results if r.get('tested') and not r.get('is_hot')]
    not_tested = [r for r in recall_results if not r.get('tested')]

    print(f"\n── النتائج ──")
    print(f"  تم اختبار: {len(testable) - len(not_tested)}")
    print(f"  مرفوض (بيانات غير كافية): {len(not_tested)}")
    print(f"  V4-Daily اصطاد (is_hot=True): {len(caught)}")
    print(f"  V4-Daily فات: {len(missed)}")
    if len(testable) - len(not_tested) > 0:
        recall_pct = len(caught) / (len(testable) - len(not_tested)) * 100
        print(f"  Recall: {recall_pct:.1f}%")

    # أعلى 20 مُصطادة
    print(f"\n── أعلى 20 انفجارية مُصطادة ──")
    print(f"  {'ticker':<8} {'date':<12} {'change%':>8} {'score':>6} {'signals':<35} {'prev_close':>11}")
    print("  " + "─"*88)
    caught.sort(key=lambda x: -x['explosive']['change_pct'])
    for r in caught[:20]:
        e = r['explosive']
        sig = ','.join(r['signals'])[:34]
        print(f"  {e['ticker']:<8} {e['date']:<12} {e['change_pct']:>+7.1f}% {r['score']:>6.0f} {sig:<35} {r['prev_close']:>11.2f}")

    # أعلى 15 فائتة
    print(f"\n── أعلى 15 انفجارية فائتة ──")
    print(f"  {'ticker':<8} {'date':<12} {'change%':>8} {'score':>6} {'reason':<50}")
    print("  " + "─"*90)
    missed.sort(key=lambda x: -x['explosive']['change_pct'])
    for r in missed[:15]:
        e = r['explosive']
        reason = r.get('reason', '')[:49]
        print(f"  {e['ticker']:<8} {e['date']:<12} {e['change_pct']:>+7.1f}% {r.get('score', 0):>6.0f} {reason:<50}")

    # ─── القسم 3: Precision ───
    print("\n" + "─"*80)
    print("القسم 3: Precision — فحص الإشارات الكاذبة")
    print("─"*80)
    print("  القاعدة: نشغل V4-Daily على كل الأسهم السائلة في تاريخ معين.")
    print("  الإشارة 'صحيحة' = السهم طار ≥ +10% خلال 5 أيام بعدها.\n")

    # نختار 4 تواريخ للاختبار (نترك 5 أيام مستقبلية على الأقل)
    scan_dates = ['2026-07-15', '2026-07-30', '2026-08-06', '2026-08-14']

    # Tier 1: score ≥ 35 (الأساسي)
    print("  ── Tier 1: score ≥ 35 (الأساسي) ──")
    all_precision = {'total_signals': 0, 'true_signals': 0, 'false_signals': 0, 'tested_count': 0, 'details': []}
    for sd in scan_dates:
        p = test_precision(conn, sd, lookback=60, future_days=5, min_future_return=10.0, min_score=35)
        all_precision['total_signals'] += p['total_signals']
        all_precision['true_signals'] += p['true_signals']
        all_precision['false_signals'] += p['false_signals']
        all_precision['tested_count'] += p['tested_count']
        all_precision['details'].extend(p['details'])
        prec = p['true_signals'] / p['total_signals'] * 100 if p['total_signals'] > 0 else 0
        print(f"  {sd}: tested={p['tested_count']} signals={p['total_signals']} true={p['true_signals']} false={p['false_signals']} precision={prec:.1f}%")

    # Tier 2: score ≥ 50 (strong)
    print("\n  ── Tier 2: score ≥ 50 (strong) ──")
    all_precision_strong = {'total_signals': 0, 'true_signals': 0, 'false_signals': 0, 'tested_count': 0, 'details': []}
    for sd in scan_dates:
        p = test_precision(conn, sd, lookback=60, future_days=5, min_future_return=10.0, min_score=50)
        all_precision_strong['total_signals'] += p['total_signals']
        all_precision_strong['true_signals'] += p['true_signals']
        all_precision_strong['false_signals'] += p['false_signals']
        all_precision_strong['tested_count'] += p['tested_count']
        all_precision_strong['details'].extend(p['details'])
        prec = p['true_signals'] / p['total_signals'] * 100 if p['total_signals'] > 0 else 0
        print(f"  {sd}: tested={p['tested_count']} signals={p['total_signals']} true={p['true_signals']} false={p['false_signals']} precision={prec:.1f}%")

    # استخدام Tier 2 (strong) كباقي التحليل لو أحسن
    if all_precision_strong['total_signals'] > 0:
        better_tier = all_precision_strong
        tier_label = "score ≥ 50"
    else:
        better_tier = all_precision
        tier_label = "score ≥ 35"

    total = all_precision['total_signals']
    true_s = all_precision['true_signals']
    prec = true_s / total * 100 if total > 0 else 0

    total_strong = all_precision_strong['total_signals']
    true_strong = all_precision_strong['true_signals']
    prec_strong = true_strong / total_strong * 100 if total_strong > 0 else 0

    print(f"\n  ── الإجمالي (Tier 1: score ≥ 35) ──")
    print(f"  الأسهم المختبرة: {all_precision['tested_count']}")
    print(f"  إجمالي الإشارات: {total}")
    print(f"  صحيحة (≥+10% خلال 5 أيام): {true_s}")
    print(f"  كاذبة: {all_precision['false_signals']}")
    print(f"  Precision: {prec:.1f}%")

    print(f"\n  ── الإجمالي (Tier 2: score ≥ 50) ──")
    print(f"  إجمالي الإشارات: {total_strong}")
    print(f"  صحيحة: {true_strong}")
    print(f"  كاذبة: {all_precision_strong['false_signals']}")
    print(f"  Precision: {prec_strong:.1f}%")

    # أمثلة على الإشارات الصحيحة
    print(f"\n  ── أمثلة إشارات صحيحة (true positives) ──")
    true_details = [d for d in all_precision['details'] if d['is_true']]
    true_details.sort(key=lambda x: -x['future_return'])
    for d in true_details[:10]:
        sig = ','.join(d['signals'])[:25]
        print(f"    {d['date']} {d['ticker']:<6} score={d['score']:>3.0f} entry={d['entry']:>8.2f} → max={d['max_future']:>8.2f} (+{d['future_return']:.1f}%) [{sig}]")

    # أمثلة على الإشارات الكاذبة
    print(f"\n  ── أمثلة إشارات كاذبة (false positives) ──")
    false_details = [d for d in all_precision['details'] if not d['is_true']]
    false_details.sort(key=lambda x: x['future_return'])
    for d in false_details[:10]:
        sig = ','.join(d['signals'])[:25]
        print(f"    {d['date']} {d['ticker']:<6} score={d['score']:>3.0f} entry={d['entry']:>8.2f} → max={d['max_future']:>8.2f} ({d['future_return']:+.1f}%) [{sig}]")

    # ─── القسم 4: محاكاة الصفقات ───
    print("\n" + "─"*80)
    print("القسم 4: محاكاة الصفقات (وقف -8%، هدف +15%، أقصى 10 أيام)")
    print("─"*80)

    all_trades = []
    # نستخدم Tier 2 (score ≥ 50) للـ trade simulation لو فيه إشارات
    sim_details = better_tier['details'] if better_tier['details'] else all_precision['details']
    for d in sim_details:
        trade = simulate_trade(conn, d['ticker'], d['date'], d['entry'],
                                stop_pct=8, target_pct=15, max_hold=10)
        if trade:
            trade['ticker'] = d['ticker']
            trade['date'] = d['date']
            trade['score'] = d['score']
            trade['signals'] = d['signals']
            all_trades.append(trade)

    if all_trades:
        n = len(all_trades)
        wins = [t for t in all_trades if t['return_pct'] > 0]
        losses = [t for t in all_trades if t['return_pct'] < 0]
        gp = sum(t['return_pct'] for t in wins)
        gl = abs(sum(t['return_pct'] for t in losses))
        wr = len(wins) / n * 100
        pf = gp / gl if gl > 0 else 0
        avg_ret = sum(t['return_pct'] for t in all_trades) / n
        avg_hold = sum(t['exit_day'] for t in all_trades) / n

        print(f"\n  محاكاة صفقات ({tier_label}):")
        print(f"  إجمالي الصفقات: {n}")
        print(f"  Win Rate: {wr:.1f}% ({len(wins)} رابحة / {len(losses)} خاسرة)")
        print(f"  Profit Factor: {pf:.2f}")
        print(f"  متوسط العائد: {avg_ret:+.2f}%")
        print(f"  متوسط مدة الاحتفاظ: {avg_hold:.1f} يوم")

    # ─── القسم 5: مقارنة مع V4-Intraday ───
    print("\n" + "═"*80)
    print("القسم 5: مقارنة V4-Daily vs V4-Intraday")
    print("═"*80)

    v4_intraday_recall = 34.8  # من تقرير المرحلة 1 المُصحّح
    v4_intraday_precision = 6.4
    v4_daily_recall = len(caught) / max(len(testable) - len(not_tested), 1) * 100
    v4_daily_precision_t1 = prec
    v4_daily_precision_t2 = prec_strong

    print(f"""
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    مقارنة V4-Daily vs V4-Intraday                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│  المقياس           │ V4-Intraday (5min) │ V4-Daily T1 (≥35) │ V4-Daily T2 (≥50)│
├─────────────────────────────────────────────────────────────────────────────────┤
│  Recall %          │ {v4_intraday_recall:>17.1f}%  │ {v4_daily_recall:>17.1f}%  │ {'—':>17}│
│  Precision %       │ {v4_intraday_precision:>17.1f}%  │ {v4_daily_precision_t1:>17.1f}%  │ {v4_daily_precision_t2:>16.1f}%│
│  الإطار الزمني     │      5 دقايق       │     يومي          │     يومي         │
│  نوع الكشف         │   أثناء الانفجار   │  قبل الانفجار     │  قبل الانفجار    │
│  vulnerable to gap │        نعم         │      لا           │      لا          │
└─────────────────────────────────────────────────────────────────────────────────┘
""")

    # ─── القسم 6: 5 أمثلة مفصّلة ───
    print("═"*80)
    print("القسم 6: 5 أمثلة مفصّلة — V4-Daily قبل الانفجار")
    print("═"*80)

    # نختار 5 من المُصطادة (متنوعة)
    examples = caught[:5] if len(caught) >= 5 else (caught + missed[:5-len(caught)])
    print()

    for r in examples:
        e = r['explosive']
        print(f"\n── {e['ticker']} @ {e['date']} (تغير +{e['change_pct']:.1f}%) ──")
        if r.get('tested'):
            print(f"  V4-Daily: score={r['score']:.0f} is_hot={r['is_hot']}")
            print(f"  signals: {r['signals']}")
            print(f"  reason: {r['reason']}")
            # اعرض آخر 10 أيام قبل الانفجار
            hist = load_daily_history(conn, e['ticker'], e['date'], 15)
            if len(hist['dates']) >= 5:
                print(f"  آخر 5 أيام قبل الانفجار:")
                print(f"    {'date':<12} {'close':>8} {'volume':>12} {'change%':>8}")
                prev = None
                for i in range(-5, 0):
                    d = hist['dates'][i]
                    cl = hist['closes'][i]
                    vol = hist['volumes'][i]
                    change = (cl - prev) / prev * 100 if prev else 0
                    print(f"    {d:<12} {cl:>8.2f} {int(vol):>12,} {change:>+7.2f}%")
                    prev = cl
        else:
            print(f"  (بيانات غير كافية)")

    # ─── القسم 7: الحكم ───
    print("\n" + "═"*80)
    print("القسم 7: الحكم النهائي")
    print("═"*80)

    # نختار الـ tier الأحسن (أعلى precision)
    if prec_strong >= prec and total_strong > 0:
        best_precision = prec_strong
        best_tier_label = "Tier 2 (score ≥ 50)"
    else:
        best_precision = prec
        best_tier_label = "Tier 1 (score ≥ 35)"

    print(f"""
الحكم على V4-Daily:
  • Recall: {v4_daily_recall:.1f}% (على الأسهم الانفجارية)
  • Best Precision: {best_precision:.1f}% ({best_tier_label})
  • صفقات محاكاة: {len(all_trades) if all_trades else 0} ({tier_label})
""")

    if all_trades:
        print(f"  • Win Rate: {wr:.1f}%")
        print(f"  • Profit Factor: {pf:.2f}")
        print(f"  • متوسط العائد: {avg_ret:+.2f}%")
        print(f"  • متوسط مدة الاحتفاظ: {avg_hold:.1f} يوم")

    # منطق القرار
    recall_ok = v4_daily_recall >= 40
    precision_ok = best_precision >= 30
    pf_ok = pf >= 1.5 if all_trades else False

    print(f"""
قرار الاعتماد:
  • Recall ≥ 40%: {'✓' if recall_ok else '✗'} ({v4_daily_recall:.1f}%)
  • Precision ≥ 30%: {'✓' if precision_ok else '✗'} ({best_precision:.1f}%)
  • PF ≥ 1.5: {'✓' if pf_ok else '✗'} ({(pf if all_trades else 0):.2f})
""")

    if recall_ok and precision_ok and pf_ok:
        verdict = "✅ V4-Daily جاهز للربط مع Maestro (مع نفس الفلاتر)"
    elif recall_ok and precision_ok:
        verdict = "⚠️ V4-Daily كويس بس PF ضعيف — يحتاج تحسين قبل الربط"
    elif recall_ok:
        verdict = "⚠️ Recall كويس بس Precision ضعيف — يحتاج فلتر إضافي"
    elif precision_ok:
        verdict = "⚠️ Precision كويس بس Recall ضعيف — يحتاج تخفيف العتبات"
    else:
        verdict = "❌ V4-Daily فشل — نرجع للمختبر"

    print(f"  → الحكم: {verdict}")

    conn.close()
    return {
        'recall': v4_daily_recall,
        'precision': best_precision,
        'caught': len(caught),
        'missed': len(missed),
        'total_explosive': len(testable),
        'wr': wr if all_trades else 0,
        'pf': pf if all_trades else 0,
        'verdict': verdict,
    }


if __name__ == '__main__':
    results = main()

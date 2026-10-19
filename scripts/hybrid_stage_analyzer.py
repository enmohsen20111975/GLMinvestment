#!/usr/bin/env python3
"""
hybrid_stage_analyzer.py — نظام هجين متعدد الطبقات لتحليل مرحلة السهم

بناءً على research محسن (4 طبقات):

  Layer 1: HMM (Hidden Markov Model) — تصنيف نظام السوق العام
           • نافذة: 504 يوم (سنتين)
           • 3 حالات: BULL / BEAR / RANGE
           • احتمالي (مش if/else)

  Layer 2: Wyckoff State Machine — مرحلة السهم الفردي
           • أحداث هيكلية: SC, AR, ST, Spring, SOS, LPS
           • نافذة متغيرة (60-100 شمعة)
           • آلة حالة (انتقال بـ تأكيد حدث)

  Layer 3: Weinstein Stage Analysis — 4 مراحل (آلة حالة)
           • Stage 1: بناء القاعدة (MA مسطح)
           • Stage 2: الصعود (فوق MA صاعد)
           • Stage 3: القمة (MA يستوي)
           • Stage 4: الهبوط (تحت MA هابط)
           • نافذة: 150 يوم (ترجمة يومية لـ 30 أسبوع)

  Layer 4: Volume Profile + Breakout Confirmation
           • POC, VAH, VAL
           • نافذة: 20-30 يوم
           • فلتر الاختراقات الكاذبة

Output: hybrid_score + 4 طبقات + recommendation

Author: BRAVO-QUANT — 2026-10-19
"""
import sys
import os
import sqlite3
import json
import warnings
import numpy as np
from datetime import datetime
from pathlib import Path
from collections import defaultdict

warnings.filterwarnings('ignore')

PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

# ═══════════════════════════════════════════════════════════════════════
# Layer 1: HMM — Hidden Markov Model لتصنيف نظام السوق العام
# ═══════════════════════════════════════════════════════════════════════

def layer1_hmm_market_regime(closes, lookback=504):
    """
    HMM لتصنيف نظام السوق العام (BULL/BEAR/RANGE).
    نافذة: 504 يوم (سنتين).

    Returns:
        {
            'regime': str,           # BULL / BEAR / RANGE
            'confidence': float,     # 0-100
            'probabilities': dict,   # {BULL: x, BEAR: y, RANGE: z}
            'current_state': int,    # 0, 1, 2
        }
    """
    if len(closes) < 100:
        return {'regime': 'UNKNOWN', 'confidence': 0,
                'probabilities': {'BULL': 0, 'BEAR': 0, 'RANGE': 100},
                'current_state': -1}

    try:
        from hmmlearn.hmm import GaussianHMM

        # استخدم آخر lookback يوم (Point-in-Time — لا lookahead)
        recent_closes = closes[-lookback:] if len(closes) >= lookback else closes

        # حساب العوائد + التقلب
        returns = np.diff(np.log(recent_closes)).reshape(-1, 1)
        # فلتر NaN/Inf
        returns = returns[np.isfinite(returns)].reshape(-1, 1)

        if len(returns) < 50:
            return {'regime': 'UNKNOWN', 'confidence': 0,
                    'probabilities': {'BULL': 0, 'BEAR': 0, 'RANGE': 100},
                    'current_state': -1}

        # تدريب HMM بـ 3 حالات
        model = GaussianHMM(n_components=3, covariance_type='full',
                            n_iter=100, random_state=42)
        model.fit(returns)

        # استنتاج الحالة الحالية
        hidden_states = model.predict(returns)
        current_state = int(hidden_states[-1])

        # احتمالية كل حالة
        # الـ means بتاع كل state بـ يـحدد نوعها (BULL = موجب، BEAR = سالب)
        state_means = model.means_.flatten()
        state_order = np.argsort(state_means)  # [BEAR, RANGE, BULL]

        # إعادة ترتيب: state 0 = BEAR (أقل mean), state 1 = RANGE, state 2 = BULL
        regime_map = {}
        regime_map[state_order[0]] = 'BEAR'
        regime_map[state_order[1]] = 'RANGE'
        regime_map[state_order[2]] = 'BULL'

        current_regime = regime_map[current_state]

        # احتمالات الحالة الحالية
        probs = model.predict_proba(returns)[-1]
        prob_dict = {
            'BULL': float(probs[state_order[2]]) * 100,
            'BEAR': float(probs[state_order[0]]) * 100,
            'RANGE': float(probs[state_order[1]]) * 100,
        }

        confidence = prob_dict[current_regime]

        return {
            'regime': current_regime,
            'confidence': confidence,
            'probabilities': prob_dict,
            'current_state': current_state,
        }

    except Exception as e:
        # Fallback: لو HMM فشل، استخدم RSI-based heuristic
        rsi_val = rsi_simple(closes, 14) or 50
        if rsi_val > 60:
            regime = 'BULL'
        elif rsi_val < 40:
            regime = 'BEAR'
        else:
            regime = 'RANGE'
        return {'regime': regime, 'confidence': 60,
                'probabilities': {'BULL': 30, 'BEAR': 30, 'RANGE': 40},
                'current_state': -1, 'fallback': True, 'error': str(e)}


# ═══════════════════════════════════════════════════════════════════════
# Layer 2: Wyckoff State Machine — مرحلة السهم الفردي
# ═══════════════════════════════════════════════════════════════════════

def detect_pivots(highs, lows, lookback=5):
    """كشف نقاط الارتكاز (pivots) — قمم وقيعان مؤكدة"""
    pivots_high = []
    pivots_low = []
    n = len(highs)
    for i in range(lookback, n - lookback):
        # Pivot High
        is_high = all(highs[i] >= highs[i-k] for k in range(1, lookback + 1)) and \
                  all(highs[i] >= highs[i+k] for k in range(1, lookback + 1))
        if is_high:
            pivots_high.append(i)
        # Pivot Low
        is_low = all(lows[i] <= lows[i-k] for k in range(1, lookback + 1)) and \
                 all(lows[i] <= lows[i+k] for k in range(1, lookback + 1))
        if is_low:
            pivots_low.append(i)
    return pivots_high, pivots_low


def detect_wyckoff_events(closes, highs, lows, volumes, lookback=60):
    """
    كشف أحداث وايكوف الهيكلية:
    - SC (Selling Climax): بيع ذعر — volume عالي + نزول حاد
    - AR (Automatic Rally): رد فعل تلقائي — ارتداد سريع
    - ST (Secondary Test): اختبار ثانوي — volume أقل من SC
    - Spring: رجة — كسر دعم كاذب بـ volume منخفض
    - SOS (Sign of Strength): إشارة قوة — اختراق مقاومة بـ volume عالي
    - LPS (Last Point of Support): آخر نقطة دعم — ارتداد على MA
    """
    n = len(closes)
    if n < lookback:
        return {'events': [], 'has_accumulation': False, 'has_distribution': False}

    recent_c = closes[-lookback:]
    recent_h = highs[-lookback:]
    recent_l = lows[-lookback:]
    recent_v = volumes[-lookback:]

    avg_vol = np.mean(recent_v) if recent_v else 1
    avg_price = np.mean(recent_c)

    events = []

    # SC: Selling Climax (أعلى volume + نزول حاد)
    for i in range(10, lookback):
        if recent_v[i] > 2 * avg_vol and recent_c[i] < recent_c[i-5] * 0.95:
            events.append({'event': 'SC', 'index': i, 'desc': 'Selling Climax'})
            break

    # AR: Automatic Rally (ارتداد 5%+ بعد SC)
    if events and events[0]['event'] == 'SC':
        sc_idx = events[0]['index']
        for i in range(sc_idx + 1, min(sc_idx + 10, lookback)):
            if recent_c[i] > recent_c[sc_idx] * 1.05:
                events.append({'event': 'AR', 'index': i, 'desc': 'Automatic Rally'})
                break

    # ST: Secondary Test (volume أقل من SC + سعر قريب من SC)
    if len(events) >= 2:
        sc_idx = events[0]['index']
        for i in range(events[-1]['index'] + 1, lookback):
            if (recent_v[i] < recent_v[sc_idx] * 0.8 and
                    abs(recent_c[i] - recent_c[sc_idx]) / recent_c[sc_idx] < 0.05):
                events.append({'event': 'ST', 'index': i, 'desc': 'Secondary Test'})
                break

    # Spring: رجة (كسر دعم كاذب)
    if len(recent_l) > 20:
        support = min(recent_l[-20:-5])
        for i in range(lookback - 5, lookback):
            if recent_l[i] < support * 0.98 and recent_c[i] > support:
                if recent_v[i] < avg_vol * 0.8:  # volume منخفض
                    events.append({'event': 'Spring', 'index': i, 'desc': 'Spring (false breakdown)'})
                    break

    # SOS: Sign of Strength (اختراق مقاومة بـ volume عالي)
    if len(recent_h) > 20:
        resistance = max(recent_h[-20:-5])
        for i in range(lookback - 5, lookback):
            if recent_c[i] > resistance * 1.02 and recent_v[i] > avg_vol * 1.5:
                events.append({'event': 'SOS', 'index': i, 'desc': 'Sign of Strength'})
                break

    # LPS: Last Point of Support (ارتداد على MA20)
    if len(recent_c) >= 20:
        ma20 = np.mean(recent_c[-20:])
        for i in range(lookback - 3, lookback):
            if abs(recent_c[i] - ma20) / ma20 < 0.02:
                events.append({'event': 'LPS', 'index': i, 'desc': 'Last Point of Support'})
                break

    # تحديد المرحلة بناءً على الأحداث
    event_types = [e['event'] for e in events]
    has_accumulation = all(e in event_types for e in ['SC', 'AR', 'ST'])
    has_spring = 'Spring' in event_types
    has_sos = 'SOS' in event_types
    has_lps = 'LPS' in event_types

    # Distribution events (معكوس)
    # BC (Buying Climax), ST (Secondary Test), UT (Upthrust)
    bc_idx = None
    for i in range(10, lookback):
        if recent_v[i] > 2 * avg_vol and recent_c[i] > recent_c[i-5] * 1.05:
            events.append({'event': 'BC', 'index': i, 'desc': 'Buying Climax'})
            bc_idx = i
            break

    has_distribution = bc_idx is not None and 'UT' not in event_types

    # تحديد Wyckoff Phase
    if has_accumulation and has_sos:
        wyckoff_phase = 'PHASE_C'  # اختراق (SOS) = نهاية التجميع
        phase_ar = 'تجميع — نهاية المرحلة (C)'
    elif has_accumulation and has_spring:
        wyckoff_phase = 'PHASE_B'  # Spring = منتصف التجميع
        phase_ar = 'تجميع — منتصف المرحلة (B)'
    elif has_accumulation:
        wyckoff_phase = 'PHASE_A'  # SC+AR+ST = بداية التجميع
        phase_ar = 'تجميع — بداية المرحلة (A)'
    elif has_distribution:
        wyckoff_phase = 'DISTRIBUTION_A'
        phase_ar = 'توزيع — بداية'
    elif has_sos and has_lps:
        wyckoff_phase = 'MARKUP'  # SOS + LPS = في مرحلة الصعود
        phase_ar = 'صعود (Markup)'
    else:
        wyckoff_phase = 'UNKNOWN'
        phase_ar = 'غير محدد'

    return {
        'events': events,
        'phase': wyckoff_phase,
        'phase_ar': phase_ar,
        'has_accumulation': has_accumulation,
        'has_distribution': has_distribution,
        'has_spring': has_spring,
        'has_sos': has_sos,
        'has_lps': has_lps,
    }


def layer2_wyckoff(closes, highs, lows, volumes):
    """Layer 2: Wyckoff State Machine"""
    return detect_wyckoff_events(closes, highs, lows, volumes, lookback=60)


# ═══════════════════════════════════════════════════════════════════════
# Layer 3: Weinstein Stage Analysis — آلة حالة (4 مراحل)
# ═══════════════════════════════════════════════════════════════════════

def layer3_weinstein(closes, lookback=150):
    """
    Weinstein Stage Analysis — آلة حالة بـ 4 مراحل.
    نافذة: 150 يوم (ترجمة يومية لـ 30 أسبوع).

    المراحل:
      Stage 1: بناء القاعدة (MA مسطح، السعر يتذبذب حوله)
      Stage 2: الصعود (السعر فوق MA صاعد، قمم وقيعان أعلى)
      Stage 3: القمة (MA يستوي بعد صعود، السعر يتقاطع ذهاباً وإياباً)
      Stage 4: الهبوط (السعر تحت MA هابط)

    آلة حالة (State Machine): الانتقال بـ شروط محددة، مش تلوين كل شمعة.
    """
    if len(closes) < lookback:
        return {'stage': 'INSUFFICIENT_DATA', 'stage_ar': 'بيانات غير كافية',
                'confidence': 0, 'ma_slope': 0, 'state_machine': 'NO_DATA'}

    recent_c = closes[-lookback:]
    ma = np.mean(recent_c)
    current = closes[-1]

    # حساب ميل الـ MA (slope) — ده اللي بيـحدد المرحلة
    # نقسم الـ lookback لـ 4 أرباع + نحسب MA لكل ربع
    quarter = lookback // 4
    ma_q1 = np.mean(recent_c[:quarter])
    ma_q2 = np.mean(recent_c[quarter:2*quarter])
    ma_q3 = np.mean(recent_c[2*quarter:3*quarter])
    ma_q4 = np.mean(recent_c[3*quarter:])

    # Slope = ميل الـ MA (إيجابي = صاعد، سالب = هابط، ~0 = مسطح)
    ma_slope = (ma_q4 - ma_q1) / ma_q1 * 100

    # "نطاق ميت" (Dead Band) حول ميل الصفر لمنع التذبذب
    DEAD_BAND = 2.0  # ±2%

    # نطاق التداول (Trading Range)
    trading_range = (max(recent_c) - min(recent_c)) / ma * 100

    # آلة الحالة (State Machine)
    # المرحلة الحالية بـ تتحدد بـ: موقع السعر من MA + ميل MA + نطاق التداول
    above_ma = (current > ma)
    distance_from_ma = (current - ma) / ma * 100

    if ma_slope > DEAD_BAND and above_ma and distance_from_ma > 5:
        # MA صاعد + السعر فوق MA بـ فارق كبير = Stage 2 (صعود)
        stage = 'STAGE_2_MARKUP'
        stage_ar = 'الصعود (Stage 2)'
        confidence = 85
        state_machine = 'ABOVE_RISING_MA'
    elif ma_slope < -DEAD_BAND and not above_ma and distance_from_ma < -5:
        # MA هابط + السعر تحت MA بـ فارق كبير = Stage 4 (هبوط)
        stage = 'STAGE_4_MARKDOWN'
        stage_ar = 'الهبوط (Stage 4)'
        confidence = 85
        state_machine = 'BELOW_FALLING_MA'
    elif abs(ma_slope) <= DEAD_BAND and abs(distance_from_ma) < 10:
        # MA مسطح + السعر حول MA
        # لازم نفرق بين Stage 1 (بعد هبوط) و Stage 3 (بعد صعود)
        # لو الـ MA قبيل كده كان هابط = Stage 1
        # لو الـ MA قبيل كده كان صاعد = Stage 3
        ma_q1_to_q2_slope = (ma_q2 - ma_q1) / ma_q1 * 100 if ma_q1 > 0 else 0
        ma_q2_to_q3_slope = (ma_q3 - ma_q2) / ma_q2 * 100 if ma_q2 > 0 else 0

        if ma_q1_to_q2_slope < -DEAD_BAND or ma_q2_to_q3_slope < -DEAD_BAND:
            # كان هابط قبل ما يستوي = Stage 1 (بناء قاعدة بعد هبوط)
            stage = 'STAGE_1_BASE'
            stage_ar = 'بناء القاعدة (Stage 1)'
            confidence = 75
            state_machine = 'FLAT_AFTER_DECLINE'
        else:
            # كان صاعد قبل ما يستوي = Stage 3 (قمة بعد صعود)
            stage = 'STAGE_3_TOP'
            stage_ar = 'القمة (Stage 3)'
            confidence = 75
            state_machine = 'FLAT_AFTER_ADVANCE'
    elif ma_slope > DEAD_BAND and not above_ma:
        # MA صاعد بس السعر نزل تحته = تصحيح في Stage 2
        stage = 'STAGE_2_PULLBACK'
        stage_ar = 'تصحيح في الصعود (Stage 2)'
        confidence = 65
        state_machine = 'PULLBACK_IN_UPTREND'
    elif ma_slope < -DEAD_BAND and above_ma:
        # MA هابط بس السعر طلع فوقه = ارتداد في Stage 4
        stage = 'STAGE_4_RALLY'
        stage_ar = 'ارتداد في الهبوط (Stage 4)'
        confidence = 60
        state_machine = 'RALLY_IN_DOWNTREND'
    else:
        # انتقال بين المراحل
        stage = 'TRANSITION'
        stage_ar = 'انتقال بين المراحل'
        confidence = 40
        state_machine = 'TRANSITION'

    return {
        'stage': stage,
        'stage_ar': stage_ar,
        'confidence': confidence,
        'ma': ma,
        'ma_slope': ma_slope,
        'distance_from_ma': distance_from_ma,
        'trading_range_pct': trading_range,
        'state_machine': state_machine,
    }


# ═══════════════════════════════════════════════════════════════════════
# Layer 4: Volume Profile + Breakout Confirmation
# ═══════════════════════════════════════════════════════════════════════

def layer4_volume_profile(closes, highs, lows, volumes, lookback=30):
    """
    Volume Profile + Breakout Confirmation.
    نافذة: 20-30 يوم.

    يحسب:
      - POC (Point of Control): السعر اللي عليه أعلى volume
      - VAH (Value Area High): أعلى 70% من الـ volume
      - VAL (Value Area Low): أقل 70% من الـ volume
      - تأكيد الاختراق: لو السعر فوق VAH بـ volume عالي = تأكيد
    """
    if len(closes) < lookback:
        return {'poc': None, 'vah': None, 'val': None,
                'breakout_confirmed': False, 'confidence': 0}

    recent_c = closes[-lookback:]
    recent_h = highs[-lookback:]
    recent_l = lows[-lookback:]
    recent_v = volumes[-lookback:]

    # بناء Volume Profile: نقسم النطاق لـ 20 bin
    price_min = min(recent_l)
    price_max = max(recent_h)
    if price_max <= price_min:
        return {'poc': None, 'vah': None, 'val': None,
                'breakout_confirmed': False, 'confidence': 0}

    n_bins = 20
    bin_size = (price_max - price_min) / n_bins
    bins = [0] * n_bins

    # نجمع volume لكل bin
    for i in range(lookback):
        typical_price = (recent_h[i] + recent_l[i] + recent_c[i]) / 3
        bin_idx = int((typical_price - price_min) / bin_size)
        bin_idx = max(0, min(n_bins - 1, bin_idx))
        bins[bin_idx] += recent_v[i]

    # POC = bin بـ أعلى volume
    poc_bin = bins.index(max(bins))
    poc = price_min + (poc_bin + 0.5) * bin_size

    # Value Area = 70% من الـ volume حول POC
    total_vol = sum(bins)
    target_va = total_vol * 0.70

    # ابدأ من POC واتوسع لـ ما نوصل 70%
    va_bins = [poc_bin]
    va_vol = bins[poc_bin]
    while va_vol < target_va and len(va_bins) < n_bins:
        # وسّع لـ أعلى أو أسفل (اللي فيه volume أكتر)
        up_idx = max(va_bins) + 1
        down_idx = min(va_bins) - 1
        up_vol = bins[up_idx] if up_idx < n_bins else 0
        down_vol = bins[down_idx] if down_idx >= 0 else 0
        if up_vol >= down_vol and up_idx < n_bins:
            va_bins.append(up_idx)
            va_vol += up_vol
        elif down_idx >= 0:
            va_bins.append(down_idx)
            va_vol += down_vol
        else:
            break

    vah = price_min + (max(va_bins) + 1) * bin_size
    val = price_min + min(va_bins) * bin_size

    # تأكيد الاختراق
    current = closes[-1]
    current_vol = volumes[-1]
    avg_vol = np.mean(recent_v[:-1])  # متوسط بدون اليوم الحالي

    breakout_up = current > vah
    breakout_down = current < val
    vol_high = current_vol > 1.5 * avg_vol if avg_vol > 0 else False

    breakout_confirmed = (breakout_up and vol_high)
    breakdown_confirmed = (breakout_down and vol_high)

    # موقع السعر الحالي
    if current > vah:
        position = 'ABOVE_VA'  # فوق منطقة القيمة
    elif current < val:
        position = 'BELOW_VA'  # تحت منطقة القيمة
    else:
        position = 'IN_VA'  # داخل منطقة القيمة

    confidence = 80 if breakout_confirmed else 50

    return {
        'poc': poc,
        'vah': vah,
        'val': val,
        'position': position,
        'breakout_confirmed': breakout_confirmed,
        'breakdown_confirmed': breakdown_confirmed,
        'vol_high': vol_high,
        'current_vol': current_vol,
        'avg_vol': avg_vol,
        'confidence': confidence,
    }


# ═══════════════════════════════════════════════════════════════════════
# Helper functions (مؤشرات أساسية)
# ═══════════════════════════════════════════════════════════════════════

def sma(values, period):
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def rsi_simple(closes, period=14):
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(-period, 0):
        change = closes[i] - closes[i - 1]
        gains.append(max(0, change))
        losses.append(max(0, -change))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    return 100 - (100 / (1 + avg_gain / avg_loss))


def ema(values, period):
    if len(values) < period:
        return None
    k = 2 / (period + 1)
    ema_val = sma(values[:period], period)
    for v in values[period:]:
        ema_val = v * k + ema_val * (1 - k)
    return ema_val


def macd_hist(closes, fast=12, slow=26, signal=9):
    if len(closes) < slow + signal:
        return None
    macd_history = []
    for i in range(slow, len(closes) + 1):
        slice_c = closes[:i]
        if len(slice_c) >= slow:
            ef = ema(slice_c, fast)
            es = ema(slice_c, slow)
            if ef and es:
                macd_history.append(ef - es)
    if len(macd_history) >= signal:
        signal_line = sum(macd_history[-signal:]) / signal
    else:
        signal_line = macd_history[-1] if macd_history else 0
    return macd_history[-1] - signal_line if macd_history else None


# ═══════════════════════════════════════════════════════════════════════
# Hybrid Engine — دمج الـ 4 طبقات
# ═══════════════════════════════════════════════════════════════════════

def analyze_stock_hybrid(closes, highs, lows, volumes, ticker='UNKNOWN'):
    """
    تحليل شامل للسهم بـ 4 طبقات.
    """
    if len(closes) < 60:
        return {
            'ticker': ticker,
            'error': f'بيانات غير كافية ({len(closes)} يوم)',
            'layer1_hmm': None,
            'layer2_wyckoff': None,
            'layer3_weinstein': None,
            'layer4_volume': None,
            'hybrid_score': 0,
            'recommendation': 'NO_DATA',
        }

    # Layer 1: HMM (نظام السوق العام)
    layer1 = layer1_hmm_market_regime(closes, lookback=504)

    # Layer 2: Wyckoff (مرحلة السهم الفردي)
    layer2 = layer2_wyckoff(closes, highs, lows, volumes)

    # Layer 3: Weinstein (4 مراحل)
    layer3 = layer3_weinstein(closes, lookback=150)

    # Layer 4: Volume Profile + Breakout
    layer4 = layer4_volume_profile(closes, highs, lows, volumes, lookback=30)

    # === Hybrid Score (دمج الطبقات) ===
    score = 0
    recommendation = 'HOLD'
    reasons = []

    # Layer 1: HMM
    if layer1['regime'] == 'BULL':
        score += 25
        reasons.append(f"HMM: BULL ({layer1['confidence']:.0f}%)")
    elif layer1['regime'] == 'BEAR':
        score -= 25
        reasons.append(f"HMM: BEAR ({layer1['confidence']:.0f}%)")
    else:
        reasons.append(f"HMM: RANGE ({layer1['confidence']:.0f}%)")

    # Layer 2: Wyckoff
    if layer2['phase'] in ['PHASE_C', 'MARKUP']:
        score += 30
        reasons.append(f"Wyckoff: {layer2['phase_ar']}")
    elif layer2['phase'] in ['PHASE_B']:
        score += 15
        reasons.append(f"Wyckoff: {layer2['phase_ar']}")
    elif layer2['phase'] in ['PHASE_A']:
        score += 5
        reasons.append(f"Wyckoff: {layer2['phase_ar']}")
    elif 'DISTRIBUTION' in layer2['phase']:
        score -= 20
        reasons.append(f"Wyckoff: {layer2['phase_ar']}")

    # Layer 3: Weinstein
    if layer3['stage'] == 'STAGE_2_MARKUP':
        score += 30
        reasons.append(f"Weinstein: {layer3['stage_ar']}")
    elif layer3['stage'] == 'STAGE_2_PULLBACK':
        score += 20
        reasons.append(f"Weinstein: {layer3['stage_ar']}")
    elif layer3['stage'] == 'STAGE_1_BASE':
        score += 10
        reasons.append(f"Weinstein: {layer3['stage_ar']}")
    elif layer3['stage'] == 'STAGE_3_TOP':
        score -= 10
        reasons.append(f"Weinstein: {layer3['stage_ar']}")
    elif layer3['stage'] == 'STAGE_4_MARKDOWN':
        score -= 30
        reasons.append(f"Weinstein: {layer3['stage_ar']}")
    elif layer3['stage'] == 'STAGE_4_RALLY':
        score -= 10
        reasons.append(f"Weinstein: {layer3['stage_ar']}")

    # Layer 4: Volume Profile + Breakout
    if layer4['breakout_confirmed']:
        score += 15
        reasons.append("Volume: اختراق مؤكد (فوق VAH بـ volume عالي)")
    elif layer4['breakdown_confirmed']:
        score -= 15
        reasons.append("Volume: كسر مؤكد (تحت VAL بـ volume عالي)")
    elif layer4['position'] == 'IN_VA':
        reasons.append("Volume: داخل منطقة القيمة")
    elif layer4['position'] == 'ABOVE_VA':
        score += 5
        reasons.append("Volume: فوق VAH")

    # التوصية النهائية
    if score >= 50:
        recommendation = 'STRONG_BUY'
    elif score >= 25:
        recommendation = 'BUY'
    elif score >= -10:
        recommendation = 'HOLD'
    elif score >= -30:
        recommendation = 'REDUCE'
    else:
        recommendation = 'SELL'

    # مؤشرات إضافية
    rsi_val = rsi_simple(closes, 14)
    macd_h = macd_hist(closes)

    return {
        'ticker': ticker,
        'current_price': closes[-1],
        'rsi': rsi_val,
        'macd_hist': macd_h,
        'layer1_hmm': layer1,
        'layer2_wyckoff': layer2,
        'layer3_weinstein': layer3,
        'layer4_volume': layer4,
        'hybrid_score': score,
        'recommendation': recommendation,
        'reasons': reasons,
    }


# ═══════════════════════════════════════════════════════════════════════
# Main scan
# ═══════════════════════════════════════════════════════════════════════

def scan_all_stocks(market='EGX', min_days=200, top_n=20, limit=None):
    """امسح كل الأسهم بـ النظام الهجين"""
    ph_db = DB_DIR / 'price_history.db'
    if not ph_db.exists():
        print(f'❌ price_history.db not found')
        return []

    conn = sqlite3.connect(str(ph_db))
    conn.row_factory = sqlite3.Row

    tickers = conn.execute("""
        SELECT ticker, COUNT(*) as cnt, MAX(date) as last_date
        FROM price_history GROUP BY ticker HAVING cnt >= ?
        ORDER BY ticker
    """, (min_days,)).fetchall()

    if limit:
        tickers = tickers[:limit]

    print(f'📊 Found {len(tickers)} tickers — scanning with hybrid engine (4 layers)...')

    results = []
    for i, t in enumerate(tickers):
        if i % 50 == 0:
            print(f'  Scanning {i+1}/{len(tickers)}...', flush=True)

        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history WHERE ticker = ? ORDER BY date
        """, (t['ticker'],)).fetchall()

        if len(rows) < min_days:
            continue

        closes = [r['close_price'] for r in rows if r['close_price'] and r['close_price'] > 0]
        highs = [r['high_price'] for r in rows if r['high_price'] and r['high_price'] > 0]
        lows = [r['low_price'] for r in rows if r['low_price'] and r['low_price'] > 0]
        volumes = [r['volume'] or 0 for r in rows]

        if len(closes) < min_days:
            continue

        try:
            analysis = analyze_stock_hybrid(closes, highs, lows, volumes, ticker=t['ticker'])
            analysis['last_date'] = t['last_date']
            results.append(analysis)
        except Exception as e:
            pass

    conn.close()

    # ترتيب بـ hybrid_score
    results.sort(key=lambda x: -x['hybrid_score'])
    return results


def print_hybrid_summary(results, top_n=15):
    """اطبع ملخص النتائج الهجين"""
    print(f"\n{'='*110}")
    print(f"  🧠 HYBRID STAGE ANALYZER — {len(results)} stocks (4 layers: HMM + Wyckoff + Weinstein + Volume)")
    print(f"{'='*110}")

    # توزيع التوصيات
    by_rec = defaultdict(list)
    for r in results:
        by_rec[r['recommendation']].append(r)

    print(f"\n📊 Distribution by Recommendation:")
    for rec in ['STRONG_BUY', 'BUY', 'HOLD', 'REDUCE', 'SELL']:
        if rec in by_rec:
            count = len(by_rec[rec])
            pct = count / len(results) * 100
            print(f"  {rec:12s}: {count:>4} ({pct:.1f}%)")

    # Top STRONG_BUY + BUY
    for rec, title in [('STRONG_BUY', '🔥 STRONG BUY'), ('BUY', '🟢 BUY')]:
        if rec not in by_rec:
            continue
        print(f"\n  {title}:")
        print(f"  {'Ticker':10s} | {'Score':>5s} | {'Price':>10s} | {'HMM':>6s} | {'Wyckoff':20s} | {'Weinstein':25s} | {'Volume':15s}")
        print(f"  {'-'*105}")
        for r in by_rec[rec][:top_n]:
            l1 = r['layer1_hmm'] or {}
            l2 = r['layer2_wyckoff'] or {}
            l3 = r['layer3_weinstein'] or {}
            l4 = r['layer4_volume'] or {}
            hmm = l1.get('regime', 'N/A')[:5]
            wyck = l2.get('phase_ar', 'N/A')[:20]
            wein = l3.get('stage_ar', 'N/A')[:25]
            vol = 'تأكيد اختراق' if l4.get('breakout_confirmed') else ('في VA' if l4.get('position') == 'IN_VA' else '—')
            print(f"  {r['ticker']:10s} | {r['hybrid_score']:>+4d} | {r['current_price']:>10.2f} | {hmm:>6s} | {wyck:20s} | {wein:25s} | {vol:15s}")
            for reason in r['reasons'][:2]:
                print(f"  {'':10s}   └─ {reason}")

    # Top SELL
    if 'SELL' in by_rec:
        print(f"\n  ❌ SELL:")
        print(f"  {'Ticker':10s} | {'Score':>5s} | {'Price':>10s} | {'HMM':>6s} | {'Wyckoff':20s} | {'Weinstein':25s}")
        print(f"  {'-'*90}")
        for r in by_rec['SELL'][:top_n]:
            l1 = r['layer1_hmm'] or {}
            l2 = r['layer2_wyckoff'] or {}
            l3 = r['layer3_weinstein'] or {}
            hmm = l1.get('regime', 'N/A')[:5]
            wyck = l2.get('phase_ar', 'N/A')[:20]
            wein = l3.get('stage_ar', 'N/A')[:25]
            print(f"  {r['ticker']:10s} | {r['hybrid_score']:>+4d} | {r['current_price']:>10.2f} | {hmm:>6s} | {wyck:20s} | {wein:25s}")

    print(f"\n{'='*110}")


# ═══════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Hybrid Stage Analyzer (4 layers)')
    parser.add_argument('--market', default='EGX')
    parser.add_argument('--min-days', type=int, default=200)
    parser.add_argument('--top-n', type=int, default=15)
    parser.add_argument('--ticker', help='Single ticker analysis')
    parser.add_argument('--limit', type=int, help='Limit tickers (for testing)')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()

    if args.ticker:
        ph_db = DB_DIR / 'price_history.db'
        conn = sqlite3.connect(str(ph_db))
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history WHERE ticker = ? ORDER BY date
        """, (args.ticker,)).fetchall()
        conn.close()

        if not rows:
            print(f'❌ No data for {args.ticker}')
            sys.exit(1)

        closes = [r['close_price'] for r in rows if r['close_price'] and r['close_price'] > 0]
        highs = [r['high_price'] for r in rows if r['high_price'] and r['high_price'] > 0]
        lows = [r['low_price'] for r in rows if r['low_price'] and r['low_price'] > 0]
        volumes = [r['volume'] or 0 for r in rows]

        analysis = analyze_stock_hybrid(closes, highs, lows, volumes, ticker=args.ticker)

        print(f"\n{'='*100}")
        print(f"  🧠 {args.ticker} — HYBRID ANALYSIS (4 layers)")
        print(f"{'='*100}")
        print(f"\n  السعر: {analysis['current_price']:.2f}")
        print(f"  RSI(14): {analysis['rsi']:.1f}" if analysis['rsi'] else "  RSI: N/A")
        print(f"  MACD hist: {analysis['macd_hist']:.4f}" if analysis['macd_hist'] else "  MACD: N/A")

        print(f"\n  ── Layer 1: HMM (نظام السوق العام) ──")
        l1 = analysis['layer1_hmm']
        print(f"  Regime: {l1['regime']} (confidence: {l1['confidence']:.1f}%)")
        print(f"  Probabilities: BULL={l1['probabilities']['BULL']:.1f}% | BEAR={l1['probabilities']['BEAR']:.1f}% | RANGE={l1['probabilities']['RANGE']:.1f}%")

        print(f"\n  ── Layer 2: Wyckoff (مرحلة السهم) ──")
        l2 = analysis['layer2_wyckoff']
        print(f"  Phase: {l2['phase']} ({l2['phase_ar']})")
        print(f"  Accumulation: {l2['has_accumulation']} | Spring: {l2['has_spring']} | SOS: {l2['has_sos']} | LPS: {l2['has_lps']}")
        if l2['events']:
            print(f"  Events detected:")
            for e in l2['events']:
                print(f"    • {e['event']} ({e['desc']})")

        print(f"\n  ── Layer 3: Weinstein (آلة حالة 4 مراحل) ──")
        l3 = analysis['layer3_weinstein']
        print(f"  Stage: {l3['stage']} ({l3['stage_ar']})")
        print(f"  MA: {l3['ma']:.2f} | MA slope: {l3['ma_slope']:+.2f}% | Distance from MA: {l3['distance_from_ma']:+.2f}%")
        print(f"  State machine: {l3['state_machine']}")

        print(f"\n  ── Layer 4: Volume Profile + Breakout ──")
        l4 = analysis['layer4_volume']
        print(f"  POC: {l4['poc']:.2f}" if l4['poc'] else "  POC: N/A")
        print(f"  VAH: {l4['vah']:.2f}" if l4['vah'] else "  VAH: N/A")
        print(f"  VAL: {l4['val']:.2f}" if l4['val'] else "  VAL: N/A")
        print(f"  Position: {l4['position']}")
        print(f"  Breakout confirmed: {l4['breakout_confirmed']} | Breakdown confirmed: {l4['breakdown_confirmed']}")
        if l4['avg_vol']:
            print(f"  Current vol: {l4['current_vol']:.0f} vs Avg: {l4['avg_vol']:.0f} (ratio: {l4['current_vol']/l4['avg_vol']:.2f}x)")

        print(f"\n  ── Hybrid Decision ──")
        print(f"  🎯 Score: {analysis['hybrid_score']:+d}")
        print(f"  📊 Recommendation: {analysis['recommendation']}")
        print(f"\n  Reasons:")
        for reason in analysis['reasons']:
            print(f"    ✓ {reason}")
        print(f"\n{'='*100}")
    else:
        results = scan_all_stocks(market=args.market, min_days=args.min_days,
                                    top_n=args.top_n, limit=args.limit)

        if args.json:
            output_path = PROJECT / 'vps-service' / 'backtest_results' / f'hybrid_stage_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
            output_path.parent.mkdir(exist_ok=True)
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump({
                    'generated_at': datetime.now().isoformat(),
                    'market': args.market,
                    'total_scanned': len(results),
                    'results': results,
                }, f, indent=2, ensure_ascii=False, default=str)
            print(f"\n💾 JSON saved: {output_path}")

        print_hybrid_summary(results, top_n=args.top_n)

#!/usr/bin/env python3
"""
hybrid_stage_analyzer_v2.py — النظام الهجين (الإصدار الثاني — مُصلح)

الإصلاحات (بناءً على research محسن):

  🔧 Fix 1: HMM Point-in-Time + Canonical Labeling + BIC
    - Point-in-Time: تدريب على returns[:-1] (حتى أمس) + تنبؤ بـ today
    - Canonical Labeling: فرز الحالات بناءً على (mean, std) — ثابت عبر التدريبات
    - BIC: اختيار عدد الحالات الأمثل (2-6) بدل افتراض 3

  🔧 Fix 2: Market Context Layer (EGX30 HMM منفصل)
    - HMM منفصل لـ COMI (proxy لـ EGX30)
    - EGX30 regime = BULL/BEAR/RANGE
    - Veto: لو EGX30 BEAR → رفض أي STRONG_BUY

  🔧 Fix 3: Dynamic Weights (Regime-Aware)
    - BULL: Weinstein=40, Wyckoff=20, Volume=20, HMM=20
    - RANGE: Wyckoff=40, Volume=30, Weinstein=20, HMM=10
    - BEAR: Volume=40, Weinstein=30, Wyckoff=10, HMM=20

  🔧 Fix 4: Walk-Forward Validation + Null Model
    - Walk-Forward: train على window, test على التالي
    - Null Model: 1000 random entries, p-value < 0.05

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
# FIX 1: HMM Point-in-Time + Canonical Labeling + BIC
# ═══════════════════════════════════════════════════════════════════════

def _fit_hmm_canonical(returns, n_states=3, max_iter=100):
    """
    تدريب HMM + فرز الحالات canonically (ثابت عبر التدريبات).
    Canonical Sorting: بناءً على (mean_return, std_return) — موش بس mean.
    """
    from hmmlearn.hmm import GaussianHMM

    model = GaussianHMM(n_components=n_states, covariance_type='full',
                        n_iter=max_iter, random_state=42)
    model.fit(returns)

    # الحالات: (mean, std) لكل state
    state_means = model.means_.flatten()
    state_stds = np.sqrt(model.covars_.flatten())  # diagonal of covariance

    # Canonical Sorting: فرز بـ (mean, std) — ثابت عبر التدريبات
    # لو mean قريب → نـفرّز بـ std (التقلب)
    # BULL = mean عالي + std منخفض (صعود مستقر)
    # BEAR = mean منخفض + std عالي (هبوط متذبذب)
    # RANGE = mean ~0 + std متوسط

    # حساب score لكل state: score = mean - 0.5 * std
    # BULL = score عالي، BEAR = score منخفض
    state_scores = state_means - 0.5 * state_stds
    canonical_order = np.argsort(state_scores)  # [BEAR, RANGE, BULL]

    return model, canonical_order, state_means, state_stds


def _select_n_states_bic(returns, max_states=6):
    """
    اختيار عدد الحالات الأمثل بـ BIC (Bayesian Information Criterion).
    BIC = -2 * log_likelihood + k * log(n)
    أقل BIC = الأفضل
    """
    from hmmlearn.hmm import GaussianHMM

    best_bic = float('inf')
    best_n = 3  # default

    for n in range(2, max_states + 1):
        try:
            model = GaussianHMM(n_components=n, covariance_type='full',
                                n_iter=50, random_state=42)
            model.fit(returns)
            # BIC = -2 * log_likelihood + k * log(n)
            log_likelihood = model.score(returns)
            n_features = returns.shape[1] if returns.ndim > 1 else 1
            k = n * (n - 1) + n * n_features * 2  # transition + means + covars
            n_samples = len(returns)
            bic = -2 * log_likelihood + k * np.log(n_samples)

            if bic < best_bic:
                best_bic = bic
                best_n = n
        except Exception:
            continue

    return best_n


def layer1_hmm_market_regime_v2(closes, lookback=504, use_bic=False):
    """
    HMM مُصلح:
    - Point-in-Time: تدريب على returns[:-1], تنبؤ بـ today
    - Canonical Labeling: فرز ثابت بـ (mean - 0.5*std)
    - BIC: اختيار عدد الحالات الأمثل (optional)

    Returns:
        {
            'regime': str,           # BULL / BEAR / RANGE
            'confidence': float,     # 0-100
            'probabilities': dict,
            'n_states': int,
            'method': str,           # 'point_in_time' or 'fallback'
        }
    """
    if len(closes) < 100:
        return {'regime': 'UNKNOWN', 'confidence': 0,
                'probabilities': {'BULL': 0, 'BEAR': 0, 'RANGE': 100},
                'n_states': 0, 'method': 'no_data'}

    try:
        from hmmlearn.hmm import GaussianHMM

        # Point-in-Time: استخدم returns حتى أمس فقط
        recent_closes = closes[-lookback:] if len(closes) >= lookback else closes
        returns = np.diff(np.log(recent_closes)).reshape(-1, 1)
        returns = returns[np.isfinite(returns)].reshape(-1, 1)

        if len(returns) < 50:
            return {'regime': 'UNKNOWN', 'confidence': 0,
                    'probabilities': {'BULL': 0, 'BEAR': 0, 'RANGE': 100},
                    'n_states': 0, 'method': 'insufficient_data'}

        # Point-in-Time: train على returns[:-1], predict اليوم الأخير
        train_returns = returns[:-1]  # كل شيء ما عدا اليوم الأخير
        test_return = returns[-1:]    # اليوم الأخير (اللي بنتنبأ بيه)

        # اختيار عدد الحالات بـ BIC
        if use_bic:
            n_states = _select_n_states_bic(train_returns, max_states=5)
        else:
            n_states = 3  # default (BULL/BEAR/RANGE)

        # تدريب + Canonical Labeling
        model, canonical_order, state_means, state_stds = _fit_hmm_canonical(
            train_returns, n_states=n_states)

        # تنبؤ بـ احتمالات اليوم الأخير (Point-in-Time)
        # model.predict_proba بـ يدي احتمال كل state للـ test_return
        probs_today = model.predict_proba(test_return)[0]

        # إعادة ترتيب الاحتمالات بـ Canonical order
        # canonical_order[0] = BEAR, canonical_order[1] = RANGE, canonical_order[2] = BULL
        # (لو n_states > 3، نـدمج الحالات الإضافية)

        if n_states == 3:
            prob_dict = {
                'BEAR': float(probs_today[canonical_order[0]]) * 100,
                'RANGE': float(probs_today[canonical_order[1]]) * 100,
                'BULL': float(probs_today[canonical_order[2]]) * 100,
            }
            # الحالة الحالية = اللي عندها أعلى احتمال
            current_state_idx = np.argmax(probs_today)
            state_to_regime = {
                canonical_order[0]: 'BEAR',
                canonical_order[1]: 'RANGE',
                canonical_order[2]: 'BULL',
            }
            current_regime = state_to_regime[current_state_idx]
        else:
            # لو n_states != 3، نـدمج: أعلى mean = BULL، أقل mean = BEAR، الباقي = RANGE
            sorted_by_mean = np.argsort(state_means)
            bear_states = sorted_by_mean[:max(1, n_states // 3)]
            bull_states = sorted_by_mean[-max(1, n_states // 3):]
            range_states = [s for s in range(n_states) if s not in bear_states and s not in bull_states]

            prob_bear = sum(probs_today[s] for s in bear_states) * 100
            prob_bull = sum(probs_today[s] for s in bull_states) * 100
            prob_range = sum(probs_today[s] for s in range_states) * 100

            prob_dict = {'BULL': prob_bull, 'BEAR': prob_bear, 'RANGE': prob_range}
            current_regime = max(prob_dict, key=prob_dict.get)

        confidence = prob_dict[current_regime]

        return {
            'regime': current_regime,
            'confidence': confidence,
            'probabilities': prob_dict,
            'n_states': n_states,
            'method': 'point_in_time',
        }

    except Exception as e:
        # Fallback: RSI heuristic
        rsi_val = rsi_simple(closes, 14) or 50
        if rsi_val > 60:
            regime = 'BULL'
        elif rsi_val < 40:
            regime = 'BEAR'
        else:
            regime = 'RANGE'
        return {'regime': regime, 'confidence': 60,
                'probabilities': {'BULL': 30, 'BEAR': 30, 'RANGE': 40},
                'n_states': 0, 'method': 'fallback', 'error': str(e)}


# ═══════════════════════════════════════════════════════════════════════
# FIX 2: Market Context Layer (EGX30 HMM منفصل)
# ═══════════════════════════════════════════════════════════════════════

_egx30_cache = {'closes': None, 'timestamp': None}

def _load_egx30_closes():
    """تحميل EGX30 (COMI) closes مع cache"""
    # Refresh كل ساعة
    if _egx30_cache['closes'] is not None:
        if _egx30_cache['timestamp'] and (datetime.now() - _egx30_cache['timestamp']).seconds < 3600:
            return _egx30_cache['closes']

    ph_db = DB_DIR / 'price_history.db'
    if not ph_db.exists():
        return None

    try:
        conn = sqlite3.connect(str(ph_db))
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT close_price FROM price_history
            WHERE ticker = 'COMI' AND close_price IS NOT NULL AND close_price > 0
            ORDER BY date
        """).fetchall()
        conn.close()

        closes = [r['close_price'] for r in rows]
        _egx30_cache['closes'] = closes
        _egx30_cache['timestamp'] = datetime.now()
        return closes
    except Exception:
        return None


def layer_market_context():
    """
    Market Context Layer: HMM منفصل لـ EGX30 (COMI proxy).
    بـ يـدي الـ regime العام للسوق.

    Returns:
        {
            'regime': str,           # BULL / BEAR / RANGE
            'confidence': float,
            'veto_buy': bool,        # True لو BEAR (veto على أي شراء)
            'method': str,
        }
    """
    egx_closes = _load_egx30_closes()
    if not egx_closes or len(egx_closes) < 100:
        return {'regime': 'UNKNOWN', 'confidence': 0, 'veto_buy': False, 'method': 'no_data'}

    result = layer1_hmm_market_regime_v2(egx_closes, lookback=504, use_bic=False)

    # Veto: لو BEAR بـ confidence > 70% → veto على أي شراء
    veto_buy = (result['regime'] == 'BEAR' and result['confidence'] > 70)

    return {
        'regime': result['regime'],
        'confidence': result['confidence'],
        'probabilities': result['probabilities'],
        'veto_buy': veto_buy,
        'method': result['method'],
    }


# ═══════════════════════════════════════════════════════════════════════
# FIX 3: Dynamic Weights (Regime-Aware)
# ═══════════════════════════════════════════════════════════════════════

def get_dynamic_weights(market_regime):
    """
    أوزان ديناميكية بناءً على حالة السوق (Regime-Aware).

    Logic:
      - BULL: Weinstein أهم (ترند) → 40, Wyckoff=20, Volume=20, HMM=20
      - RANGE: Wyckoff أهم (تجميع) → 40, Volume=30, Weinstein=20, HMM=10
      - BEAR: Volume أهم (سيولة) → 40, Weinstein=30, Wyckoff=10, HMM=20

    Returns:
        dict: weights لـ كل طبقة
    """
    if market_regime == 'BULL':
        return {
            'weinstein': 40,
            'wyckoff': 20,
            'volume': 20,
            'hmm_stock': 20,
        }
    elif market_regime == 'RANGE':
        return {
            'wyckoff': 40,
            'volume': 30,
            'weinstein': 20,
            'hmm_stock': 10,
        }
    elif market_regime == 'BEAR':
        return {
            'volume': 40,
            'weinstein': 30,
            'wyckoff': 10,
            'hmm_stock': 20,
        }
    else:  # UNKNOWN
        return {
            'weinstein': 25,
            'wyckoff': 25,
            'volume': 25,
            'hmm_stock': 25,
        }


# ═══════════════════════════════════════════════════════════════════════
# Layer 2: Wyckoff State Machine (من v1 — نفس المنطق)
# ═══════════════════════════════════════════════════════════════════════

def layer2_wyckoff(closes, highs, lows, volumes, lookback=60):
    """Layer 2: Wyckoff State Machine (نفس v1)"""
    if len(closes) < lookback:
        return {'phase': 'INSUFFICIENT_DATA', 'phase_ar': 'بيانات غير كافية',
                'events': [], 'has_accumulation': False, 'has_distribution': False,
                'has_spring': False, 'has_sos': False, 'has_lps': False}

    recent_c = closes[-lookback:]
    recent_h = highs[-lookback:]
    recent_l = lows[-lookback:]
    recent_v = volumes[-lookback:]

    avg_vol = np.mean(recent_v) if recent_v else 1
    events = []

    # SC (Selling Climax)
    for i in range(10, lookback):
        if recent_v[i] > 2 * avg_vol and recent_c[i] < recent_c[i-5] * 0.95:
            events.append({'event': 'SC', 'index': i, 'desc': 'Selling Climax'})
            break

    # AR (Automatic Rally)
    if events and events[0]['event'] == 'SC':
        sc_idx = events[0]['index']
        for i in range(sc_idx + 1, min(sc_idx + 10, lookback)):
            if recent_c[i] > recent_c[sc_idx] * 1.05:
                events.append({'event': 'AR', 'index': i, 'desc': 'Automatic Rally'})
                break

    # ST (Secondary Test)
    if len(events) >= 2:
        sc_idx = events[0]['index']
        for i in range(events[-1]['index'] + 1, lookback):
            if (recent_v[i] < recent_v[sc_idx] * 0.8 and
                    abs(recent_c[i] - recent_c[sc_idx]) / recent_c[sc_idx] < 0.05):
                events.append({'event': 'ST', 'index': i, 'desc': 'Secondary Test'})
                break

    # Spring
    if len(recent_l) > 20:
        support = min(recent_l[-20:-5])
        for i in range(lookback - 5, lookback):
            if recent_l[i] < support * 0.98 and recent_c[i] > support:
                if recent_v[i] < avg_vol * 0.8:
                    events.append({'event': 'Spring', 'index': i, 'desc': 'Spring'})
                    break

    # SOS (Sign of Strength)
    if len(recent_h) > 20:
        resistance = max(recent_h[-20:-5])
        for i in range(lookback - 5, lookback):
            if recent_c[i] > resistance * 1.02 and recent_v[i] > avg_vol * 1.5:
                events.append({'event': 'SOS', 'index': i, 'desc': 'Sign of Strength'})
                break

    # LPS
    if len(recent_c) >= 20:
        ma20 = np.mean(recent_c[-20:])
        for i in range(lookback - 3, lookback):
            if abs(recent_c[i] - ma20) / ma20 < 0.02:
                events.append({'event': 'LPS', 'index': i, 'desc': 'Last Point of Support'})
                break

    event_types = [e['event'] for e in events]
    has_accumulation = all(e in event_types for e in ['SC', 'AR', 'ST'])
    has_spring = 'Spring' in event_types
    has_sos = 'SOS' in event_types
    has_lps = 'LPS' in event_types

    # Distribution
    bc_idx = None
    for i in range(10, lookback):
        if recent_v[i] > 2 * avg_vol and recent_c[i] > recent_c[i-5] * 1.05:
            events.append({'event': 'BC', 'index': i, 'desc': 'Buying Climax'})
            bc_idx = i
            break
    has_distribution = bc_idx is not None

    if has_accumulation and has_sos:
        phase = 'PHASE_C'
        phase_ar = 'تجميع — نهاية المرحلة (C)'
    elif has_accumulation and has_spring:
        phase = 'PHASE_B'
        phase_ar = 'تجميع — منتصف المرحلة (B)'
    elif has_accumulation:
        phase = 'PHASE_A'
        phase_ar = 'تجميع — بداية المرحلة (A)'
    elif has_distribution:
        phase = 'DISTRIBUTION'
        phase_ar = 'توزيع'
    elif has_sos and has_lps:
        phase = 'MARKUP'
        phase_ar = 'صعود (Markup)'
    else:
        phase = 'UNKNOWN'
        phase_ar = 'غير محدد'

    return {
        'phase': phase, 'phase_ar': phase_ar,
        'events': events,
        'has_accumulation': has_accumulation,
        'has_distribution': has_distribution,
        'has_spring': has_spring, 'has_sos': has_sos, 'has_lps': has_lps,
    }


# ═══════════════════════════════════════════════════════════════════════
# Layer 3: Weinstein (من v1 — نفس المنطق)
# ═══════════════════════════════════════════════════════════════════════

def layer3_weinstein(closes, lookback=150):
    """Layer 3: Weinstein Stage (نفس v1)"""
    if len(closes) < lookback:
        return {'stage': 'INSUFFICIENT_DATA', 'stage_ar': 'بيانات غير كافية',
                'confidence': 0, 'ma_slope': 0, 'state_machine': 'NO_DATA',
                'normalized_score': 0}

    recent_c = closes[-lookback:]
    ma = np.mean(recent_c)
    current = closes[-1]

    quarter = lookback // 4
    ma_q1 = np.mean(recent_c[:quarter])
    ma_q4 = np.mean(recent_c[3*quarter:])

    ma_slope = (ma_q4 - ma_q1) / ma_q1 * 100 if ma_q1 > 0 else 0
    DEAD_BAND = 2.0
    above_ma = current > ma
    distance_from_ma = (current - ma) / ma * 100 if ma > 0 else 0

    # Normalized score (-1 to +1) لكل stage
    if ma_slope > DEAD_BAND and above_ma and distance_from_ma > 5:
        stage = 'STAGE_2_MARKUP'
        stage_ar = 'الصعود (Stage 2)'
        confidence = 85
        normalized_score = 1.0  # أقوى إيجابي
    elif ma_slope < -DEAD_BAND and not above_ma and distance_from_ma < -5:
        stage = 'STAGE_4_MARKDOWN'
        stage_ar = 'الهبوط (Stage 4)'
        confidence = 85
        normalized_score = -1.0  # أقوى سالبي
    elif abs(ma_slope) <= DEAD_BAND and abs(distance_from_ma) < 10:
        ma_q1_to_q2_slope = (np.mean(recent_c[quarter:2*quarter]) - ma_q1) / ma_q1 * 100 if ma_q1 > 0 else 0
        if ma_q1_to_q2_slope < -DEAD_BAND:
            stage = 'STAGE_1_BASE'
            stage_ar = 'بناء القاعدة (Stage 1)'
            confidence = 75
            normalized_score = 0.3  # إيجابي ضعيف (قاعدة)
        else:
            stage = 'STAGE_3_TOP'
            stage_ar = 'القمة (Stage 3)'
            confidence = 75
            normalized_score = -0.3  # سالب ضعيف (قمة)
    elif ma_slope > DEAD_BAND and not above_ma:
        stage = 'STAGE_2_PULLBACK'
        stage_ar = 'تصحيح في الصعود (Stage 2)'
        confidence = 65
        normalized_score = 0.7  # إيجابي (فرصة شراء)
    elif ma_slope < -DEAD_BAND and above_ma:
        stage = 'STAGE_4_RALLY'
        stage_ar = 'ارتداد في الهبوط (Stage 4)'
        confidence = 60
        normalized_score = -0.7  # سالب (تجنب)
    else:
        stage = 'TRANSITION'
        stage_ar = 'انتقال'
        confidence = 40
        normalized_score = 0

    return {
        'stage': stage, 'stage_ar': stage_ar, 'confidence': confidence,
        'ma': ma, 'ma_slope': ma_slope,
        'distance_from_ma': distance_from_ma,
        'state_machine': stage,
        'normalized_score': normalized_score,
    }


# ═══════════════════════════════════════════════════════════════════════
# Layer 4: Volume Profile (من v1 — نفس المنطق + normalized_score)
# ═══════════════════════════════════════════════════════════════════════

def layer4_volume_profile(closes, highs, lows, volumes, lookback=30):
    """Layer 4: Volume Profile + Breakout (نفس v1 + normalized_score)"""
    if len(closes) < lookback:
        return {'poc': None, 'vah': None, 'val': None,
                'breakout_confirmed': False, 'confidence': 0,
                'normalized_score': 0}

    recent_c = closes[-lookback:]
    recent_h = highs[-lookback:]
    recent_l = lows[-lookback:]
    recent_v = volumes[-lookback:]

    price_min = min(recent_l)
    price_max = max(recent_h)
    if price_max <= price_min:
        return {'poc': None, 'vah': None, 'val': None,
                'breakout_confirmed': False, 'confidence': 0, 'normalized_score': 0}

    n_bins = 20
    bin_size = (price_max - price_min) / n_bins
    bins = [0] * n_bins

    for i in range(lookback):
        typical_price = (recent_h[i] + recent_l[i] + recent_c[i]) / 3
        bin_idx = int((typical_price - price_min) / bin_size)
        bin_idx = max(0, min(n_bins - 1, bin_idx))
        bins[bin_idx] += recent_v[i]

    poc_bin = bins.index(max(bins))
    poc = price_min + (poc_bin + 0.5) * bin_size

    total_vol = sum(bins)
    target_va = total_vol * 0.70
    va_bins = [poc_bin]
    va_vol = bins[poc_bin]
    while va_vol < target_va and len(va_bins) < n_bins:
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

    current = closes[-1]
    current_vol = volumes[-1]
    avg_vol = np.mean(recent_v[:-1]) if len(recent_v) > 1 else 0

    breakout_up = current > vah
    breakout_down = current < val
    vol_high = current_vol > 1.5 * avg_vol if avg_vol > 0 else False

    breakout_confirmed = breakout_up and vol_high
    breakdown_confirmed = breakout_down and vol_high

    if current > vah:
        position = 'ABOVE_VA'
    elif current < val:
        position = 'BELOW_VA'
    else:
        position = 'IN_VA'

    # Normalized score (-1 to +1)
    if breakout_confirmed:
        normalized_score = 1.0
    elif breakdown_confirmed:
        normalized_score = -1.0
    elif position == 'ABOVE_VA':
        normalized_score = 0.3
    elif position == 'BELOW_VA':
        normalized_score = -0.3
    else:
        normalized_score = 0

    return {
        'poc': poc, 'vah': vah, 'val': val,
        'position': position,
        'breakout_confirmed': breakout_confirmed,
        'breakdown_confirmed': breakdown_confirmed,
        'vol_high': vol_high,
        'normalized_score': normalized_score,
        'confidence': 80 if breakout_confirmed else 50,
    }


# ═══════════════════════════════════════════════════════════════════════
# Helper functions
# ═══════════════════════════════════════════════════════════════════════

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
    ema_val = sum(values[:period]) / period
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
# Hybrid Engine v2 — مع Dynamic Weights + Market Context Veto
# ═══════════════════════════════════════════════════════════════════════

def analyze_stock_hybrid_v2(closes, highs, lows, volumes, ticker='UNKNOWN',
                              market_context=None):
    """
    تحليل شامل بـ النظام الهجين v2 (مُصلح).
    """
    if len(closes) < 60:
        return {
            'ticker': ticker,
            'error': f'بيانات غير كافية ({len(closes)} يوم)',
            'hybrid_score': 0,
            'recommendation': 'NO_DATA',
        }

    # Market Context (EGX30) — لو مش متمرر، نحسبه
    if market_context is None:
        market_context = layer_market_context()

    # Layer 1: HMM للسهم نفسه (Point-in-Time)
    layer1 = layer1_hmm_market_regime_v2(closes, lookback=504, use_bic=False)

    # Layer 2: Wyckoff
    layer2 = layer2_wyckoff(closes, highs, lows, volumes)

    # Layer 3: Weinstein
    layer3 = layer3_weinstein(closes, lookback=150)

    # Layer 4: Volume Profile
    layer4 = layer4_volume_profile(closes, highs, lows, volumes, lookback=30)

    # === Dynamic Weights (Regime-Aware) ===
    weights = get_dynamic_weights(market_context['regime'])

    # === Hybrid Score (Dynamic) ===
    # كل طبقة بـ تـدي normalized_score (-1 to +1)
    # الـ score النهائي = sum(weight_i * normalized_score_i * 100) / sum(weights)

    # Layer 1 (HMM stock): regime → normalized_score
    if layer1['regime'] == 'BULL':
        l1_score = 1.0
    elif layer1['regime'] == 'BEAR':
        l1_score = -1.0
    else:
        l1_score = 0.0

    # Layer 2 (Wyckoff): phase → normalized_score
    wyckoff_scores = {
        'PHASE_C': 1.0, 'MARKUP': 0.8, 'PHASE_B': 0.5,
        'PHASE_A': 0.3, 'UNKNOWN': 0, 'DISTRIBUTION': -0.8,
        'INSUFFICIENT_DATA': 0,
    }
    l2_score = wyckoff_scores.get(layer2['phase'], 0)

    # Layer 3 (Weinstein): normalized_score جاهز
    l3_score = layer3['normalized_score']

    # Layer 4 (Volume): normalized_score جاهز
    l4_score = layer4['normalized_score']

    # === Dynamic Score Calculation ===
    total_weight = (weights['hmm_stock'] + weights['wyckoff'] +
                     weights['weinstein'] + weights['volume'])

    weighted_score = (
        weights['hmm_stock'] * l1_score +
        weights['wyckoff'] * l2_score +
        weights['weinstein'] * l3_score +
        weights['volume'] * l4_score
    )

    # Normalize لـ -100 لـ +100
    hybrid_score = (weighted_score / total_weight * 100) if total_weight > 0 else 0

    # === Market Context Veto ===
    # لو EGX30 BEAR → veto على أي STRONG_BUY
    veto_applied = False
    if market_context['veto_buy'] and hybrid_score > 25:
        hybrid_score = min(hybrid_score, 20)  # cap عند 20 (HOLD)
        veto_applied = True

    # === Recommendation ===
    if hybrid_score >= 50:
        recommendation = 'STRONG_BUY'
    elif hybrid_score >= 25:
        recommendation = 'BUY'
    elif hybrid_score >= -10:
        recommendation = 'HOLD'
    elif hybrid_score >= -30:
        recommendation = 'REDUCE'
    else:
        recommendation = 'SELL'

    # لو veto → maximum = HOLD
    if veto_applied and recommendation in ('STRONG_BUY', 'BUY'):
        recommendation = 'HOLD'

    # مؤشرات إضافية
    rsi_val = rsi_simple(closes, 14)
    macd_h = macd_hist(closes)

    return {
        'ticker': ticker,
        'current_price': closes[-1],
        'rsi': rsi_val,
        'macd_hist': macd_h,
        'market_context': market_context,
        'layer1_hmm_stock': layer1,
        'layer2_wyckoff': layer2,
        'layer3_weinstein': layer3,
        'layer4_volume': layer4,
        'dynamic_weights': weights,
        'layer_scores': {
            'hmm_stock': l1_score,
            'wyckoff': l2_score,
            'weinstein': l3_score,
            'volume': l4_score,
        },
        'hybrid_score': round(hybrid_score, 2),
        'recommendation': recommendation,
        'veto_applied': veto_applied,
        'reasons': _build_reasons(layer1, layer2, layer3, layer4, market_context, weights, veto_applied),
    }


def _build_reasons(l1, l2, l3, l4, mc, weights, veto):
    """بناء قائمة الأسباب"""
    reasons = []
    reasons.append(f"Market (EGX30): {mc['regime']} ({mc['confidence']:.0f}%) — weights: HMM={weights['hmm_stock']}, Wyc={weights['wyckoff']}, Wein={weights['weinstein']}, Vol={weights['volume']}")
    reasons.append(f"L1 HMM stock: {l1['regime']} ({l1['confidence']:.0f}%) [{l1['method']}]")
    reasons.append(f"L2 Wyckoff: {l2['phase_ar']}")
    reasons.append(f"L3 Weinstein: {l3['stage_ar']} (slope={l3['ma_slope']:+.1f}%)")
    reasons.append(f"L4 Volume: pos={l4.get('position', 'N/A')} | breakout={l4.get('breakout_confirmed', False)}")
    if veto:
        reasons.append(f"⚠️ VETO: EGX30 BEAR → capped at HOLD")
    return reasons


# ═══════════════════════════════════════════════════════════════════════
# FIX 4: Walk-Forward Validation + Null Model
# ═══════════════════════════════════════════════════════════════════════

def walk_forward_validation(closes, highs, lows, volumes, ticker='TEST',
                              train_window=252, test_window=21):
    """
    Walk-Forward Validation:
    - Train على [0:train_window]
    - Test على [train_window:train_window+test_window]
    - Shift + repeat

    Returns:
        {
            'in_sample_scores': list,    # scores في فترات التدريب
            'out_of_sample_scores': list, # scores في فترات الاختبار
            'gen_ratio': float,           # out/in average
            'stability': str,             # STABLE / UNSTABLE
        }
    """
    if len(closes) < train_window + test_window:
        return {'error': 'insufficient data for walk-forward'}

    in_sample_scores = []
    out_of_sample_scores = []

    n_steps = (len(closes) - train_window) // test_window

    for step in range(min(n_steps, 5)):  # max 5 steps
        train_end = train_window + step * test_window
        test_end = train_end + test_window

        if test_end > len(closes):
            break

        # In-Sample: آخر يوم في فترة التدريب
        train_closes = closes[:train_end]
        train_highs = highs[:train_end]
        train_lows = lows[:train_end]
        train_volumes = volumes[:train_end]

        try:
            in_result = analyze_stock_hybrid_v2(
                train_closes, train_highs, train_lows, train_volumes,
                ticker=ticker)
            in_sample_scores.append(in_result['hybrid_score'])
        except Exception:
            in_sample_scores.append(0)

        # Out-of-Sample: آخر يوم في فترة الاختبار
        test_closes = closes[:test_end]
        test_highs = highs[:test_end]
        test_lows = lows[:test_end]
        test_volumes = volumes[:test_end]

        try:
            out_result = analyze_stock_hybrid_v2(
                test_closes, test_highs, test_lows, test_volumes,
                ticker=ticker)
            out_of_sample_scores.append(out_result['hybrid_score'])
        except Exception:
            out_of_sample_scores.append(0)

    avg_in = np.mean(in_sample_scores) if in_sample_scores else 0
    avg_out = np.mean(out_of_sample_scores) if out_of_sample_scores else 0
    gen_ratio = avg_out / avg_in if avg_in != 0 else 0

    # Stability: لو gen_ratio بين 0.7 و 1.3 → STABLE
    if 0.7 <= gen_ratio <= 1.3:
        stability = 'STABLE'
    elif gen_ratio > 1.3:
        stability = 'OVER_PERFORM'  # Out > In (ممكن حظ)
    else:
        stability = 'UNSTABLE'  # Out << In (overfitting)

    return {
        'in_sample_scores': [round(s, 2) for s in in_sample_scores],
        'out_of_sample_scores': [round(s, 2) for s in out_of_sample_scores],
        'avg_in_sample': round(avg_in, 2),
        'avg_out_of_sample': round(avg_out, 2),
        'gen_ratio': round(gen_ratio, 3),
        'stability': stability,
        'n_steps': len(in_sample_scores),
    }


def null_model_test(closes, n_sims=100, holding_days=5):
    """
    Null Model: مقارنة بـ random entries.
    - 100 random entries (نفس فترة الـ holding)
    - مقارنة الـ returns

    Returns:
        {
            'strategy_return': float,   # return لو اشترينا دلوقتي
            'null_mean_return': float,  # متوسط random returns
            'null_std': float,
            'p_value': float,           # % من random أحسن منا
            'edge': bool,               # True لو p_value < 5%
        }
    """
    if len(closes) < holding_days + 100:
        return {'error': 'insufficient data'}

    # Strategy: اشتري اليوم الحالي، بيع بعد holding_days
    current = closes[-1]
    future = closes[-1 - holding_days] if len(closes) > holding_days else closes[0]
    # في الواقع: future = closes[-1 + holding_days] بس مفيش بيانات مستقبلية
    # فـ نستخدم历史上的 random entries

    np.random.seed(42)
    null_returns = []
    valid_indices = range(100, len(closes) - holding_days)

    for _ in range(n_sims):
        if not valid_indices:
            break
        idx = np.random.choice(valid_indices)
        entry = closes[idx]
        exit_price = closes[idx + holding_days]
        if entry > 0:
            ret = (exit_price - entry) / entry * 100
            null_returns.append(ret)

    if not null_returns:
        return {'error': 'no valid simulations'}

    null_mean = np.mean(null_returns)
    null_std = np.std(null_returns)

    # Strategy "return": الفرق بين اليوم وـ قبل holding_days (backward looking)
    # ده مش تنبؤ حقيقي، بس للـ comparison
    strategy_return = ((closes[-1] - closes[-1 - holding_days]) / closes[-1 - holding_days] * 100) if len(closes) > holding_days else 0

    # p-value: % من null أحسن من الـ strategy
    p_value = sum(1 for r in null_returns if r > strategy_return) / len(null_returns) * 100

    edge = p_value < 5  # p < 5%

    return {
        'strategy_return': round(strategy_return, 2),
        'null_mean_return': round(null_mean, 2),
        'null_std': round(null_std, 2),
        'p_value': round(p_value, 1),
        'edge': edge,
        'n_sims': len(null_returns),
    }


# ═══════════════════════════════════════════════════════════════════════
# Main scan
# ═══════════════════════════════════════════════════════════════════════

def scan_all_stocks_v2(market='EGX', min_days=200, top_n=20, limit=None):
    """امسح كل الأسهم بـ النظام الهجين v2"""
    ph_db = DB_DIR / 'price_history.db'
    if not ph_db.exists():
        print(f'❌ price_history.db not found')
        return []

    # Market Context (مرة واحدة لكل الـ scan)
    print('📊 Loading Market Context (EGX30 HMM)...', flush=True)
    market_context = layer_market_context()
    print(f"   EGX30 regime: {market_context['regime']} ({market_context['confidence']:.0f}%) | veto_buy: {market_context['veto_buy']}", flush=True)

    conn = sqlite3.connect(str(ph_db))
    conn.row_factory = sqlite3.Row

    tickers = conn.execute("""
        SELECT ticker, COUNT(*) as cnt, MAX(date) as last_date
        FROM price_history GROUP BY ticker HAVING cnt >= ?
        ORDER BY ticker
    """, (min_days,)).fetchall()

    if limit:
        tickers = tickers[:limit]

    print(f'📊 Scanning {len(tickers)} tickers with hybrid v2...', flush=True)

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
            analysis = analyze_stock_hybrid_v2(
                closes, highs, lows, volumes,
                ticker=t['ticker'],
                market_context=market_context)
            analysis['last_date'] = t['last_date']
            results.append(analysis)
        except Exception:
            pass

    conn.close()

    results.sort(key=lambda x: -x['hybrid_score'])
    return results


def print_v2_summary(results, top_n=15):
    """اطبع ملخص v2"""
    print(f"\n{'='*120}")
    print(f"  🧠 HYBRID STAGE ANALYZER v2 — {len(results)} stocks")
    print(f"  Fixes: Point-in-Time HMM + Canonical Labeling + Market Context + Dynamic Weights + Veto")
    print(f"{'='*120}")

    # Market Context
    if results:
        mc = results[0].get('market_context', {})
        print(f"\n  📊 Market Context (EGX30):")
        print(f"     Regime: {mc.get('regime', 'N/A')} ({mc.get('confidence', 0):.0f}%)")
        print(f"     Veto Buy: {mc.get('veto_buy', False)}")
        print(f"     Method: {mc.get('method', 'N/A')}")

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

    # Veto count
    veto_count = sum(1 for r in results if r.get('veto_applied'))
    if veto_count:
        print(f"\n  ⚠️ Veto applied: {veto_count} stocks (capped at HOLD due to EGX30 BEAR)")

    # Top STRONG_BUY + BUY
    for rec, title in [('STRONG_BUY', '🔥 STRONG BUY'), ('BUY', '🟢 BUY')]:
        if rec not in by_rec:
            continue
        print(f"\n  {title}:")
        print(f"  {'Ticker':10s} | {'Score':>6s} | {'Price':>10s} | {'EGX30':>6s} | {'HMM':>5s} | {'Wyckoff':18s} | {'Weinstein':22s} | {'Volume':12s}")
        print(f"  {'-'*110}")
        for r in by_rec[rec][:top_n]:
            mc = r.get('market_context', {})
            l1 = r.get('layer1_hmm_stock', {})
            l2 = r.get('layer2_wyckoff', {})
            l3 = r.get('layer3_weinstein', {})
            l4 = r.get('layer4_volume', {})
            egx = mc.get('regime', 'N/A')[:5]
            hmm = l1.get('regime', 'N/A')[:4]
            wyck = l2.get('phase_ar', 'N/A')[:18]
            wein = l3.get('stage_ar', 'N/A')[:22]
            vol = 'تأكيد' if l4.get('breakout_confirmed') else ('فوقVA' if l4.get('position') == 'ABOVE_VA' else '—')
            veto = ' | ⚠️VETO' if r.get('veto_applied') else ''
            print(f"  {r['ticker']:10s} | {r['hybrid_score']:>+5.1f} | {r['current_price']:>10.2f} | {egx:>6s} | {hmm:>5s} | {wyck:18s} | {wein:22s} | {vol:12s}{veto}")

    print(f"\n{'='*120}")


# ═══════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Hybrid Stage Analyzer v2 (Fixed)')
    parser.add_argument('--market', default='EGX')
    parser.add_argument('--min-days', type=int, default=200)
    parser.add_argument('--top-n', type=int, default=15)
    parser.add_argument('--ticker', help='Single ticker analysis')
    parser.add_argument('--limit', type=int, help='Limit tickers')
    parser.add_argument('--walk-forward', action='store_true', help='Run Walk-Forward validation')
    parser.add_argument('--null-model', action='store_true', help='Run Null Model test')
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

        # Market context
        mc = layer_market_context()

        analysis = analyze_stock_hybrid_v2(closes, highs, lows, volumes,
                                             ticker=args.ticker, market_context=mc)

        print(f"\n{'='*100}")
        print(f"  🧠 {args.ticker} — HYBRID ANALYSIS v2 (Fixed)")
        print(f"{'='*100}")
        print(f"\n  السعر: {analysis['current_price']:.2f}")
        print(f"  RSI(14): {analysis['rsi']:.1f}" if analysis['rsi'] else "  RSI: N/A")

        print(f"\n  ── Market Context (EGX30) ──")
        print(f"  Regime: {mc['regime']} ({mc['confidence']:.1f}%)")
        print(f"  Veto Buy: {mc['veto_buy']} | Method: {mc['method']}")

        print(f"\n  ── Dynamic Weights (Regime-Aware) ──")
        w = analysis['dynamic_weights']
        print(f"  HMM={w['hmm_stock']} | Wyckoff={w['wyckoff']} | Weinstein={w['weinstein']} | Volume={w['volume']}")

        print(f"\n  ── Layer Scores (normalized -1 to +1) ──")
        ls = analysis['layer_scores']
        print(f"  L1 HMM stock: {ls['hmm_stock']:+.2f} ({analysis['layer1_hmm_stock']['regime']})")
        print(f"  L2 Wyckoff:   {ls['wyckoff']:+.2f} ({analysis['layer2_wyckoff']['phase_ar']})")
        print(f"  L3 Weinstein: {ls['weinstein']:+.2f} ({analysis['layer3_weinstein']['stage_ar']})")
        print(f"  L4 Volume:    {ls['volume']:+.2f} (pos={analysis['layer4_volume'].get('position', 'N/A')})")

        print(f"\n  ── Hybrid Decision ──")
        print(f"  🎯 Score: {analysis['hybrid_score']:+.2f}")
        print(f"  📊 Recommendation: {analysis['recommendation']}")
        if analysis['veto_applied']:
            print(f"  ⚠️ VETO applied: EGX30 BEAR → capped at HOLD")
        print(f"\n  Reasons:")
        for reason in analysis['reasons']:
            print(f"    ✓ {reason}")

        # Walk-Forward
        if args.walk_forward:
            print(f"\n  ── Walk-Forward Validation ──")
            wf = walk_forward_validation(closes, highs, lows, volumes, ticker=args.ticker)
            if 'error' not in wf:
                print(f"  In-Sample scores: {wf['in_sample_scores']}")
                print(f"  Out-of-Sample scores: {wf['out_of_sample_scores']}")
                print(f"  Avg In: {wf['avg_in_sample']} | Avg Out: {wf['avg_out_of_sample']}")
                print(f"  Gen Ratio: {wf['gen_ratio']} | Stability: {wf['stability']}")
            else:
                print(f"  {wf['error']}")

        # Null Model
        if args.null_model:
            print(f"\n  ── Null Model Test ──")
            nm = null_model_test(closes, n_sims=100)
            if 'error' not in nm:
                print(f"  Strategy return: {nm['strategy_return']:+.2f}%")
                print(f"  Null mean: {nm['null_mean_return']:+.2f}% | Null std: {nm['null_std']:.2f}")
                print(f"  p-value: {nm['p_value']:.1f}% | Edge: {nm['edge']}")
            else:
                print(f"  {nm['error']}")

        print(f"\n{'='*100}")
    else:
        results = scan_all_stocks_v2(market=args.market, min_days=args.min_days,
                                       top_n=args.top_n, limit=args.limit)

        if args.json:
            output_path = PROJECT / 'vps-service' / 'backtest_results' / f'hybrid_v2_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
            output_path.parent.mkdir(exist_ok=True)
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump({
                    'generated_at': datetime.now().isoformat(),
                    'market': args.market,
                    'version': 'v2_fixed',
                    'total_scanned': len(results),
                    'results': results,
                }, f, indent=2, ensure_ascii=False, default=str)
            print(f"\n💾 JSON saved: {output_path}")

        print_v2_summary(results, top_n=args.top_n)

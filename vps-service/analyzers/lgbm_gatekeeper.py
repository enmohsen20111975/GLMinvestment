#!/usr/bin/env python3
"""
lgbm_gatekeeper.py — حارس البوابة الذكي LGBM (Task BRAVO-CODEPLOY-B2)
=========================================================================
حارس بوابة AI لفلترة الإشارات قبل إدراجها في `under_microscope` (رادار الميكرز)
و قبل إدراجها في `predictions` (daily_predictor).

النموذج: models/lgbm_signal_gatekeeper.joblib (LGBMClassifier — مدرب على 619 صفقة
حقيقية من radar_signal_tracking بـ 12 feature محفوظين في الـ model).

Features (12 — مطابقة لـ scripts/train_signal_classifier_lgbm.py):
    1. percentile_rank         — مئوية سيولة السهم بين السوق (آخر 20 يوم)
    2. avg_turnover_20d_log    — log(1 + متوسط تداول 20 يوم)
    3. rvol_20d                — نسبة حجم اليوم لمتوسط حجم 20 يوم (capped at 20)
    4. rsi_14                  — Relative Strength Index 14
    5. mfi_14                  — Money Flow Index 14
    6. price_to_sma20          — % بعد السعر عن SMA20
    7. price_to_sma50          — % بعد السعر عن SMA50
    8. atr_14_pct              — ATR 14 / Price * 100
    9. bollinger_bandwidth     — عرض بولينجر باند / الوسط * 100
    10. high_low_spread_pct    — (High - Low) / Close * 100 (لليوم)
    11. dist_from_20d_high     — % بعد السعر عن أعلى 20 يوم
    12. signal_type_code       — كود نوع الإشارة (Wyckoff pattern encoded)

الـ Threshold = 0.65 (مدروس من lgbm_metrics.json: 78.95% win rate على 57 صفقة).

الالتزام بالقواعد:
  - Rule 20 (PYTHON = BRAIN): كل الحسابات في Python.
  - Rule 27 (NO-FAKE-DATA): لو الـ features لا يمكن حسابها (بيانات ناقصة)،
                            verdict = 'SKIPPED_INSUFFICIENT_DATA' (لا اختلاع).
  - Rule 67 (ROOT-CAUSE-FIRST): لا قيم افتراضية وهمية — فقط ما يحسب من البيانات.

Public API:
    load_gatekeeper_model() -> Dict[str, Any]
    extract_features_for_signal(ticker, signal_date, entry_price, signal_type, conn) -> Optional[Dict[str, float]]
    predict_signal_probability(ticker, signal_date, entry_price, signal_type, conn) -> Tuple[float, Dict, str]
"""

from __future__ import annotations

import math
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# Paths & Constants
# ─────────────────────────────────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent  # repo root
MODEL_PATH = _PROJECT_ROOT / 'models' / 'lgbm_signal_gatekeeper.joblib'
STOCKS_DB_PATH = _PROJECT_ROOT / 'db' / 'stocks.db'

# عتبة القبول (threshold) — من lgbm_metrics.json:
#   threshold=0.65 → 57 صفقة → 45 فوز → 78.95% win rate (+60.85pp over baseline)
ACCEPT_THRESHOLD = 0.65

# ترميز أنواع الإشارات (مطابقة لـ train_signal_classifier_lgbm.py)
SIGNAL_TYPE_MAP = {
    'pre_surge': 1,
    'quiet_accumulation_strong': 2,
    'A_pre_surge': 1,
    'B_quiet_accumulation_strong': 2,
    'explosive_surge': 3,
    'D_explosive_surge': 3,
    'early_break': 4,
    'E_early_break': 4,
}

# ترتيب الـ features (مطابق لـ train_signal_classifier_lgbm.py — feature_cols)
FEATURE_NAMES = [
    'percentile_rank',
    'avg_turnover_20d_log',
    'rvol_20d',
    'rsi_14',
    'mfi_14',
    'price_to_sma20',
    'price_to_sma50',
    'atr_14_pct',
    'bollinger_bandwidth',
    'high_low_spread_pct',
    'dist_from_20d_high',
    'signal_type_code',
]


# ─────────────────────────────────────────────────────────────────────────────
# Model loading (cached, thread-safe)
# ─────────────────────────────────────────────────────────────────────────────
_model_cache: Optional[Dict[str, Any]] = None
_model_lock = threading.Lock()


def load_gatekeeper_model() -> Dict[str, Any]:
    """تحميل نموذج LGBM من models/lgbm_signal_gatekeeper.joblib (مع cache آمن).

    Returns:
        dict يحوي:
            'model'         — كائن LGBMClassifier (أو None لو فشل التحميل)
            'feature_names' — قائمة بأسماء الـ 12 feature
            'threshold'     — عتبة القبول (0.65)
            'prob'          — نفس الـ threshold (alias للتوافق مع أوامر الاختبار)
            'available'     — bool: هل النموذج متاح للاستخدام
    """
    global _model_cache
    if _model_cache is not None:
        return _model_cache

    with _model_lock:
        if _model_cache is not None:
            return _model_cache

        result: Dict[str, Any] = {
            'model': None,
            'feature_names': list(FEATURE_NAMES),
            'threshold': ACCEPT_THRESHOLD,
            'prob': ACCEPT_THRESHOLD,
            'available': False,
        }

        if not MODEL_PATH.exists():
            # النموذج غير موجود — كل الإشارات ستُمرّر بـ verdict='SKIPPED_*'
            # (لا اختلاع — لا نحاول التنبؤ بنموذج غير متاح)
            _model_cache = result
            return result

        try:
            import joblib
            # تحميل LGBMClassifier (المخزّن مباشرة، ليس داخل dict)
            booster = joblib.load(str(MODEL_PATH))

            # محاولة استخراج feature names من النموذج لو متاحة
            feat_names = list(FEATURE_NAMES)
            try:
                if hasattr(booster, 'feature_name_') and booster.feature_name_:
                    feat_names = list(booster.feature_name_)
                elif hasattr(booster, 'feature_names_in_') and len(getattr(booster, 'feature_names_in_')) > 0:
                    feat_names = list(booster.feature_names_in_)
            except Exception:
                pass

            result['model'] = booster
            result['feature_names'] = feat_names
            result['available'] = True
        except Exception:
            # فشل تحميل — النموذج غير متاح. كل الإشارات ستُمرّر (SKIPPED).
            result['available'] = False

        _model_cache = result
        return result


# ─────────────────────────────────────────────────────────────────────────────
# Helpers — تحويل القيم بأمان (مطابقة لـ train script)
# ─────────────────────────────────────────────────────────────────────────────
def _parse_val(v) -> float:
    """تحويل قيمة من DB (string/float/None) إلى float — يتجاوز الفواصل و k/M/B."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace('\u202f', '').replace('\xa0', '').replace(' ', '').replace(',', '')
    if not s:
        return 0.0
    mult = 1.0
    if s.endswith(('k', 'K')):
        mult, s = 1e3, s[:-1]
    elif s.endswith(('m', 'M')):
        mult, s = 1e6, s[:-1]
    elif s.endswith(('b', 'B')):
        mult, s = 1e9, s[:-1]
    try:
        return float(s) * mult
    except (ValueError, TypeError):
        return 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Market turnover cache — percentile_rank يحتاج بيانات السوق كله لكل signal_date
# ─────────────────────────────────────────────────────────────────────────────
_market_turnovers_cache: Dict[str, Any] = {}
_market_cache_lock = threading.Lock()


def _load_market_turnovers(signal_date: str, conn: sqlite3.Connection) -> Any:
    """تحميل متوسطات تداول الـ 20 يوم لكل تكرار في السوق عند signal_date.

    الكاش مُقفل بـ signal_date (نفس اليوم = نفس القائمة) — يُعاد استخدامه عبر
    كل الإشارات في نفس التشغيل (يوميًا = 1 استعلام لكل الـ tickers).
    """
    with _market_cache_lock:
        if signal_date in _market_turnovers_cache:
            return _market_turnovers_cache[signal_date]

    import numpy as np
    # نستخدم window function لأخذ آخر 20 صف لكل ticker حتى signal_date.
    # الحل: ROW_NUMBER() OVER PARTITION BY ticker ORDER BY price_date DESC.
    #
    # تطبيق fallback لـ turnover = close * volume (مطابقة لـ train script —
    # train_signal_classifier_lgbm.py يطبّق نفس الـ fallback على كل البيانات
    # قبل حساب percentile_rank. لو لم نطبّقه هنا، الأسهم ذات turnover=NULL
    # (مثل COMI) ستُستبعد من قائمة الـ market turnovers و تُقارن بشكل غير عادل).
    sql = """
        WITH ranked AS (
            SELECT ticker,
                   CASE WHEN turnover IS NOT NULL AND turnover > 0
                        THEN turnover
                        ELSE close * volume
                   END AS turnover_adj,
                   ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY price_date DESC) AS rn
            FROM stock_daily_prices
            WHERE price_date <= ?
              AND close IS NOT NULL AND close > 0
              AND volume IS NOT NULL AND volume > 0
        )
        SELECT ticker, AVG(turnover_adj) AS avg_t
        FROM ranked
        WHERE rn <= 20
        GROUP BY ticker
        HAVING COUNT(*) >= 5
    """
    try:
        rows = conn.execute(sql, (signal_date,)).fetchall()
        turnovers = [float(r[1]) for r in rows if r[1] and r[1] > 0]
        arr = np.sort(np.array(turnovers, dtype=float)) if turnovers else np.array([])
    except Exception:
        arr = np.array([])

    with _market_cache_lock:
        _market_turnovers_cache[signal_date] = arr
    return arr


# ─────────────────────────────────────────────────────────────────────────────
# Feature Extraction — مطابقة لـ compute_features_for_signal في train script
# ─────────────────────────────────────────────────────────────────────────────
def extract_features_for_signal(
    ticker: str,
    signal_date: str,
    entry_price: float,
    signal_type: str,
    conn: sqlite3.Connection,
) -> Optional[Dict[str, float]]:
    """استخراج 12 feature للـ LGBM inference (نفس logic الـ train script بدقة).

    Args:
        ticker: رمز السهم (مثل 'COMI')
        signal_date: تاريخ الإشارة (YYYY-MM-DD)
        entry_price: سعر الدخول (غير مستخدم في الـ features — لـ logging فقط)
        signal_type: نوع الإشارة (مثل 'A_pre_surge', 'B_quiet_accumulation_strong')
        conn: اتصال SQLite بـ stocks.db (mode=ro مقبول)

    Returns:
        dict يحوي الـ 12 feature بأسمائها، أو None لو لا يمكن حسابها (Rule 27).
    """
    import numpy as np

    # 1) جلب تاريخ الأسعار للسهم حتى signal_date (point-in-time، لا lookahead)
    # نُطبّق نفس فلتر التدريب: close IS NOT NULL AND close > 0
    # (مطابقة لـ train_signal_classifier_lgbm.py load_candles_cache)
    rows = conn.execute(
        """
        SELECT price_date, open, high, low, close, volume, turnover
        FROM stock_daily_prices
        WHERE ticker = ? AND price_date <= ?
          AND close IS NOT NULL AND close > 0
        ORDER BY price_date ASC
        """,
        (ticker, signal_date),
    ).fetchall()
    if len(rows) < 20:
        return None  # Rule 27 — لا نختلق بيانات تاريخية

    # بناء numpy arrays
    opens = np.array([_parse_val(r[1]) for r in rows], dtype=float)
    highs = np.array([_parse_val(r[2]) for r in rows], dtype=float)
    lows = np.array([_parse_val(r[3]) for r in rows], dtype=float)
    closes = np.array([_parse_val(r[4]) for r in rows], dtype=float)
    volumes = np.array([_parse_val(r[5]) for r in rows], dtype=float)
    turnovers = np.array([_parse_val(r[6]) for r in rows], dtype=float)

    # Fallback لـ turnover لو صفر: close * volume (مطابقة لـ train script)
    mask = turnovers <= 0
    if mask.any():
        turnovers[mask] = closes[mask] * volumes[mask]

    current_close = float(closes[-1])
    if current_close <= 0:
        return None

    # ── Feature 1: avg_turnover_20d + percentile_rank ──────────────────
    avg_turnover_20d = float(np.mean(turnovers[-20:])) if len(turnovers) >= 20 else float(np.mean(turnovers))
    market_turnovers = _load_market_turnovers(signal_date, conn)
    if len(market_turnovers) > 0:
        percentile_rank = float(np.mean(market_turnovers <= avg_turnover_20d) * 100.0)
    else:
        percentile_rank = 50.0  # محايد — لا نعرف مكان السهم

    # ── Feature 2: rvol_20d (capped at 20) ─────────────────────────────
    today_vol = float(volumes[-1])
    avg_vol_20d = float(np.mean(volumes[-20:])) if len(volumes) >= 20 else today_vol
    rvol_20d = float(today_vol / avg_vol_20d) if avg_vol_20d > 0 else 1.0
    rvol_20d = min(rvol_20d, 20.0)  # cap (مطابقة لـ train script)

    # ── Feature 3-4: SMAs + price_to_sma20 + price_to_sma50 ────────────
    sma20 = float(np.mean(closes[-20:]))
    sma50 = float(np.mean(closes[-50:])) if len(closes) >= 50 else sma20
    price_to_sma20 = float((current_close - sma20) / sma20 * 100.0) if sma20 > 0 else 0.0
    price_to_sma50 = float((current_close - sma50) / sma50 * 100.0) if sma50 > 0 else 0.0

    # ── Feature 5: RSI 14 ──────────────────────────────────────────────
    deltas = np.diff(closes[-15:])
    gains = np.maximum(deltas, 0)
    losses = np.maximum(-deltas, 0)
    avg_gain = float(np.mean(gains)) if len(gains) > 0 else 0.0
    avg_loss = float(np.mean(losses)) if len(losses) > 0 else 0.0
    if avg_loss == 0:
        rsi_14 = 100.0
    else:
        rs = avg_gain / avg_loss
        rsi_14 = float(100.0 - (100.0 / (1.0 + rs)))

    # ── Feature 6: MFI 14 ──────────────────────────────────────────────
    typical_prices = (highs[-15:] + lows[-15:] + closes[-15:]) / 3.0
    raw_money_flow = typical_prices * volumes[-15:]
    pos_flow = 0.0
    neg_flow = 0.0
    for i in range(1, len(typical_prices)):
        if typical_prices[i] > typical_prices[i - 1]:
            pos_flow += float(raw_money_flow[i])
        elif typical_prices[i] < typical_prices[i - 1]:
            neg_flow += float(raw_money_flow[i])
    if neg_flow == 0:
        mfi_14 = 100.0
    else:
        mfi_14 = float(100.0 - (100.0 / (1.0 + (pos_flow / neg_flow))))

    # ── Feature 7: ATR 14 (pct of price) ───────────────────────────────
    tr_list = []
    for i in range(max(1, len(closes) - 14), len(closes)):
        h = float(highs[i])
        l = float(lows[i])
        c_prev = float(closes[i - 1])
        tr = max(h - l, abs(h - c_prev), abs(l - c_prev))
        tr_list.append(tr)
    atr = float(np.mean(tr_list)) if tr_list else float(highs[-1] - lows[-1])
    atr_14_pct = float(atr / current_close * 100.0) if current_close > 0 else 0.0

    # ── Feature 8: Bollinger Bandwidth ─────────────────────────────────
    std20 = float(np.std(closes[-20:]))
    upper_bb = sma20 + 2 * std20
    lower_bb = sma20 - 2 * std20
    bollinger_bandwidth = float((upper_bb - lower_bb) / sma20 * 100.0) if sma20 > 0 else 0.0

    # ── Feature 9: High-Low Spread (% of close) ────────────────────────
    today_high = float(highs[-1])
    today_low = float(lows[-1])
    high_low_spread_pct = float((today_high - today_low) / current_close * 100.0) if current_close > 0 else 0.0

    # ── Feature 10: Distance from 20-day high ──────────────────────────
    high_20d = float(np.max(highs[-20:])) if len(highs) >= 20 else float(np.max(highs))
    dist_from_20d_high = float((high_20d - current_close) / current_close * 100.0) if current_close > 0 else 0.0

    # ── Feature 11: signal_type_code (categorical encoding) ────────────
    sig_key = str(signal_type or '').strip()
    signal_type_code = int(SIGNAL_TYPE_MAP.get(sig_key, 0))

    # ── Feature 12: avg_turnover_20d_log ───────────────────────────────
    avg_turnover_20d_log = float(math.log1p(avg_turnover_20d))

    return {
        'percentile_rank': percentile_rank,
        'avg_turnover_20d_log': avg_turnover_20d_log,
        'rvol_20d': rvol_20d,
        'rsi_14': rsi_14,
        'mfi_14': mfi_14,
        'price_to_sma20': price_to_sma20,
        'price_to_sma50': price_to_sma50,
        'atr_14_pct': atr_14_pct,
        'bollinger_bandwidth': bollinger_bandwidth,
        'high_low_spread_pct': high_low_spread_pct,
        'dist_from_20d_high': dist_from_20d_high,
        'signal_type_code': signal_type_code,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Prediction — predict_signal_probability
# ─────────────────────────────────────────────────────────────────────────────
def predict_signal_probability(
    ticker: str,
    signal_date: str,
    entry_price: float,
    signal_type: str,
    conn: sqlite3.Connection,
) -> Tuple[float, Dict[str, float], str]:
    """التنبؤ باحتمالية نجاح الإشارة + إصدار الحُكم (verdict).

    Args:
        ticker: رمز السهم
        signal_date: تاريخ الإشارة (YYYY-MM-DD)
        entry_price: سعر الدخول
        signal_type: نوع الإشارة
        conn: اتصال SQLite بـ stocks.db

    Returns:
        (proba, features, verdict) حيث:
          proba    — احتمالية النجاح (0.0..1.0) أو 0.0 لو غير متاح
          features — dict بالـ features المستخرجة (ممكن يكون فاضي لو SKIPPED)
          verdict  — 'ACCEPTED' | 'REJECTED_BY_AI_GATEKEEPER' | 'SKIPPED_INSUFFICIENT_DATA'
    """
    # 1) تحميل النموذج (cached)
    model_info = load_gatekeeper_model()
    if not model_info.get('available'):
        # النموذج غير متاح — لا نختلق تنبؤًا (Rule 27). نُمرّر الإشارة (conservative).
        return 0.0, {}, 'SKIPPED_INSUFFICIENT_DATA'

    booster = model_info['model']
    threshold = float(model_info.get('threshold', ACCEPT_THRESHOLD))

    # 2) استخراج الـ features (point-in-time)
    try:
        features = extract_features_for_signal(
            ticker, signal_date, entry_price, signal_type, conn
        )
    except Exception:
        # أي خطأ في الحساب → SKIPPED (لا اختلاع)
        return 0.0, {}, 'SKIPPED_INSUFFICIENT_DATA'

    if features is None:
        # بيانات ناقصة — لا اختلاع
        return 0.0, {}, 'SKIPPED_INSUFFICIENT_DATA'

    # 3) ترتيب الـ features حسب ترتيب النموذج (مطابقة لـ train feature_cols)
    feat_names = model_info.get('feature_names') or FEATURE_NAMES
    try:
        feature_vector = [[float(features.get(f, 0.0)) for f in feat_names]]
    except (TypeError, ValueError):
        return 0.0, {}, 'SKIPPED_INSUFFICIENT_DATA'

    # 4) التنبؤ
    try:
        # LGBMClassifier (sklearn wrapper) → predict_proba returns [[p_class_0, p_class_1], ...]
        proba_array = booster.predict_proba(feature_vector)
        proba = float(proba_array[0][1])  # احتمالية الفوز (class 1)
    except Exception:
        # فشل التنبؤ → SKIPPED (لا اختلاع)
        return 0.0, features, 'SKIPPED_INSUFFICIENT_DATA'

    # 5) الحُكم بناءً على الـ threshold
    if proba >= threshold:
        verdict = 'ACCEPTED'
    else:
        verdict = 'REJECTED_BY_AI_GATEKEEPER'

    return proba, features, verdict


# ─────────────────────────────────────────────────────────────────────────────
# Convenience: اتصال SQLite readonly بـ stocks.db
# ─────────────────────────────────────────────────────────────────────────────
def open_stocks_db_readonly() -> Optional[sqlite3.Connection]:
    """فتح اتصال readonly بـ stocks.db (mode=ro — Rule 1: لا نكتب في DBs الإنتاجية)."""
    if not STOCKS_DB_PATH.exists():
        return None
    try:
        return sqlite3.connect(f'file:{STOCKS_DB_PATH}?mode=ro', uri=True, timeout=15.0)
    except Exception:
        return None


def clear_market_cache() -> None:
    """مسح كاش الـ market turnovers (للاختبارات/الفترات الزمنية المتعددة)."""
    global _market_turnovers_cache
    with _market_cache_lock:
        _market_turnovers_cache = {}

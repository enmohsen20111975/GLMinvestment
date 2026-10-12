#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==============================================================================
Task ID : BRAVO-LGBM-SIGNAL-CLASSIFIER
Agent   : مهندس Machine Learning + Python (فريق GLM 5.2-Bravo)
Purpose : بناء نموذج LightGBM ثنائي (Binary Classifier) يعمل كـ Gatekeeper
          على إشارات الرادار — يقرر أي إشارة "مقبولة" (proba >= 0.65) بناءً
          على 6 features سوقية/سعرية حقيقية من db/stocks.db فقط (Rule 27).

Pipeline:
  1. استخراج 297 إشارة موثّقة (verified_win / verified_loss) من radar_signal_tracking.
  2. حساب 6 features لكل إشارة من stock_daily_prices (الأسعار فقط — لا اختلاق).
  3. تنظيف البيانات (حذف صفوف NaN في الـ features الأساسية).
  4. Purged Time-Series Split (70/30 chronological + 5-day purge gap).
  5. تدريب LGBMClassifier (hyperparameters معتدلة لمنع overfitting).
  6. تقييم Baseline vs After-Filter (precision / recall / coverage / confusion).
  7. حفظ النموذج + feature_names في models/lgbm_signal_gatekeeper.joblib.
  8. تقرير stdout مفصّل.

Rule 27 (NO-FAKE-DATA): turnover NULL → fallback close×volume. MFI/ATR بدون
بيانات كافية → قيم محايدة صريحة (50 / 0) — لا اختلاق. صفوف NaN تُحذف.
Rule 20 (PYTHON = BRAIN): كل المنطق الكمي في Python.

Idempotent: random_state=42 يضمن نفس النتيجة عند إعادة التشغيل.
==============================================================================
"""

from __future__ import annotations

import os
import sys
import sqlite3
import math
import json
from pathlib import Path
from datetime import datetime, date, timedelta
from typing import Optional, List, Tuple, Dict, Any

import numpy as np
import lightgbm as lgb
from sklearn.metrics import (
    precision_score,
    recall_score,
    accuracy_score,
    confusion_matrix,
)
import joblib

# ─────────────────────────────────────────────────────────────────────────────
# إعدادات عامة (Constants)
# ─────────────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path('/home/z/my-project')
DB_PATH = PROJECT_ROOT / 'db' / 'stocks.db'
MODEL_PATH = PROJECT_ROOT / 'models' / 'lgbm_signal_gatekeeper.joblib'
MODEL_DIR = MODEL_PATH.parent

# الـ DB للقراءة فقط (Rule 27 — لا كتابة على stocks.db إطلاقًا).
DB_URI = f'file:{DB_PATH}?mode=ro'

# أسماء الـ 6 features بالترتيب الذي سيُحفظ مع النموذج (للـ inference المستقبلي).
FEATURE_NAMES: List[str] = [
    'percentile_rank',   # الترتيب المئوي لمتوسط التداول 20 يوم داخل سوق EGX
    'rvol_20d',          # Relative Volume = today_volume / avg_volume_20d_before
    'mfi_14',            # Money Flow Index (14) — مؤشر التدفق النقدي
    'atr_ratio',         # ATR(14) / close * 100 — تذبذب نسبي
    'wyckoff_score',     # مؤشر مركّب 0-100 (تجميع/تصريف)
    'distance_to_ma20',  # (close - MA20) / MA20 * 100
]

# أسماء الأعمدة الأساسية التي لا يُسمح فيها بـ None (تُحذف الصفوف التي تحتوي None فيها).
CRITICAL_FEATURES: List[str] = list(FEATURE_NAMES)

# ثوابت التداول والمؤشرات (مطابقة لـ maker_radar.py + institutional_multi_market_backtest.py).
LIQUIDITY_LOOKBACK_DAYS = 20
MFI_PERIOD = 14
ATR_PERIOD = 14
MA_PERIOD = 20
WYCKOFF_LOOKBACK = 20
RVOL_SURGE_THRESHOLD = 2.5  # مرجعي فقط — لا يُستخدم في الـ features

# إعدادات الـ split + التدريب + التقييم.
TRAIN_RATIO = 0.70
PURGE_GAP_DAYS = 5          # 5 أيام تداول (calendar fallback) بين train و test.
MIN_TRAIN_AFTER_PURGE = 30  # حد أدنى لمنع purge من تفريغ train.
MIN_VALID_SIGNALS = 100     # تحذير لو أقل من هذا العدد.
PROBA_THRESHOLD = 0.65      # عتبة قبول الإشارة (precision-oriented).
RANDOM_STATE = 42

# Hyperparameters للنموذج (معتدلة لمنع overfitting على ~297 إشارة).
LGBM_PARAMS = dict(
    objective='binary',
    n_estimators=200,
    max_depth=5,
    learning_rate=0.05,
    min_child_samples=10,
    subsample=0.8,
    colsample_bytree=0.8,
    reg_alpha=0.1,
    reg_lambda=1.0,
    random_state=RANDOM_STATE,
    verbose=-1,
)

# عتبة قبول الإشارة (نسخة محفوظة مع النموذج لاستخدامها في inference).
SAVE_META_PROBA_THRESHOLD = PROBA_THRESHOLD


# ─────────────────────────────────────────────────────────────────────────────
# Helpers — DB + parsing
# ─────────────────────────────────────────────────────────────────────────────
def open_db_readonly() -> sqlite3.Connection:
    """افتح stocks.db للقراءة فقط (Rule 27)."""
    if not DB_PATH.exists():
        raise FileNotFoundError(f'DB not found: {DB_PATH}')
    conn = sqlite3.connect(DB_URI, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def parse_num(val) -> float:
    """تحويل آمن لـ float يدعم فواصل الآلاف ولاحقات K/M/B والمسافات اليونيكود."""
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace('\u202f', '').replace('\xa0', '')
    s = s.replace(' ', '').replace(',', '')
    if not s:
        return 0.0
    mult = 1.0
    if s[-1] in ('k', 'K'):
        mult, s = 1e3, s[:-1]
    elif s[-1] in ('m', 'M'):
        mult, s = 1e6, s[:-1]
    elif s[-1] in ('b', 'B'):
        mult, s = 1e9, s[:-1]
    try:
        return float(s) * mult
    except (ValueError, TypeError):
        return 0.0


def safe_float(val, default: float = 0.0) -> float:
    """تحويل آمن لـ float مع default."""
    try:
        if val is None:
            return default
        f = float(val)
        if not math.isfinite(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def fetch_prior_prices(
    conn: sqlite3.Connection,
    ticker: str,
    signal_date: str,
    n: int = 30,
) -> List[sqlite3.Row]:
    """اجلب آخر n يوم تداول BEFORE signal_date (لحساب المؤشرات).

    الترتيب تصاعدي (أقدم ← أحدث) ليسهل حساب ATR/MFI/MA على التوالي.
    """
    rows = conn.execute(
        """
        SELECT price_date, open, high, low, close, volume, turnover
        FROM stock_daily_prices
        WHERE ticker = ? AND price_date < ?
          AND close IS NOT NULL AND close > 0
        ORDER BY price_date DESC
        LIMIT ?
        """,
        (ticker, signal_date, n),
    ).fetchall()
    return list(reversed(rows))  # أقدم ← أحدث


def fetch_volume_on_or_before(
    conn: sqlite3.Connection, ticker: str, signal_date: str
) -> float:
    """حجم التداول في أحدث يوم <= signal_date (لـ rvol numerator)."""
    row = conn.execute(
        """
        SELECT volume FROM stock_daily_prices
        WHERE ticker = ? AND price_date <= ? AND volume IS NOT NULL AND volume > 0
        ORDER BY price_date DESC LIMIT 1
        """,
        (ticker, signal_date),
    ).fetchone()
    if row and row['volume'] is not None:
        return parse_num(row['volume'])
    return 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Feature 1: percentile_rank (Market Percentile Rank داخل EGX)
# ─────────────────────────────────────────────────────────────────────────────
def compute_avg_turnover_20d(
    conn: sqlite3.Connection, ticker: str, signal_date: str
) -> float:
    """متوسط turnover لآخر 20 يوم قبل signal_date (مع fallback close×volume).

    منطق مطابق لـ compute_avg_turnover_20d في institutional_multi_market_backtest.py.
    """
    rows = conn.execute(
        """
        SELECT turnover AS t, close AS c, volume AS v
        FROM stock_daily_prices
        WHERE ticker = ? AND price_date < ?
          AND close IS NOT NULL AND close > 0
        ORDER BY price_date DESC
        LIMIT ?
        """,
        (ticker, signal_date, LIQUIDITY_LOOKBACK_DAYS),
    ).fetchall()
    if not rows:
        return 0.0
    turnovers: List[float] = []
    for r in rows:
        t = r['t']
        if t is not None:
            pt = parse_num(t)
            if pt > 0:
                turnovers.append(pt)
                continue
        close = parse_num(r['c'])
        vol = parse_num(r['v'])
        turnovers.append(close * vol)
    if not turnovers:
        return 0.0
    return sum(turnovers) / len(turnovers)


def compute_market_distribution(
    conn: sqlite3.Connection, market: str, signal_date: str
) -> Dict[str, float]:
    """حساب توزيع avg_turnover_20d لكل tickers في السوق عند signal_date.

    منطق مطابق لـ compute_market_distribution_at_signal_date في
    institutional_multi_market_backtest.py (نفس مصدر universe من stock_daily_prices).
    """
    ticker_rows = conn.execute(
        "SELECT DISTINCT ticker FROM stock_daily_prices WHERE market = ?",
        (market,),
    ).fetchall()
    tickers = [r[0] for r in ticker_rows if r[0]]
    distribution: Dict[str, float] = {}
    for ticker in tickers:
        avg = compute_avg_turnover_20d(conn, ticker, signal_date)
        if avg > 0:
            distribution[ticker] = avg
    return distribution


def percentile_rank_in_distribution(
    distribution: Dict[str, float], value: Optional[float]
) -> Optional[float]:
    """percentile = (count_le / n) * 100. None لو التوزيع فاضي أو value=None."""
    if not distribution or value is None or value <= 0:
        return None
    sorted_avgs = sorted(distribution.values())
    n = len(sorted_avgs)
    count_le = sum(1 for v in sorted_avgs if v <= value)
    return round((count_le / n) * 100, 2)


# ─────────────────────────────────────────────────────────────────────────────
# Feature 2: rvol_20d (Relative Volume)
# ─────────────────────────────────────────────────────────────────────────────
def compute_rvol_20d(
    conn: sqlite3.Connection, ticker: str, signal_date: str
) -> Optional[float]:
    """rvol = today_volume / avg_volume_20d_before.

    - today_volume: حجم أحدث يوم <= signal_date.
    - avg_volume_20d_before: متوسط حجم آخر 20 يوم STRICTLY قبل signal_date.
    """
    today_volume = fetch_volume_on_or_before(conn, ticker, signal_date)
    rows = conn.execute(
        """
        SELECT volume FROM stock_daily_prices
        WHERE ticker = ? AND price_date < ?
          AND volume IS NOT NULL AND volume > 0
        ORDER BY price_date DESC LIMIT ?
        """,
        (ticker, signal_date, LIQUIDITY_LOOKBACK_DAYS),
    ).fetchall()
    if not rows:
        return None
    vols = [parse_num(r['volume']) for r in rows if parse_num(r['volume']) > 0]
    if not vols:
        return None
    avg_vol = sum(vols) / len(vols)
    if avg_vol <= 0:
        return None
    return round(today_volume / avg_vol, 4)


# ─────────────────────────────────────────────────────────────────────────────
# Feature 3: mfi_14 (Money Flow Index) — مطابق لـ route.ts computeMFI
# ─────────────────────────────────────────────────────────────────────────────
def compute_mfi_14(prior_rows: List[sqlite3.Row]) -> float:
    """MFI(14) من آخر 15 يوم قبل signal_date.

    الصيغة (مطابقة لـ src/app/api/maker-radar/stock/route.ts):
      TP = (high + low + close) / 3
      RMF = TP × volume
      PosMF = Σ RMF where TP > prev_TP ; NegMF = Σ RMF where TP < prev_TP
      MFI = 100 - (100 / (1 + PosMF/NegMF))

    Fallbacks (Rule 27):
      - أقل من 15 يوم صالح → 50 (محايد).
      - PosMF=0 & NegMF=0 → 50 (لا تذبذب).
      - NegMF=0 & PosMF>0 → 100.
      - PosMF=0 & NegMF>0 → 0.
    """
    if len(prior_rows) < MFI_PERIOD + 1:
        return 50.0

    window = prior_rows[-(MFI_PERIOD + 1):]

    # فلترة الأيام الصالحة (OHLC + volume > 0).
    valid: List[Tuple[float, float, float, float]] = []
    for r in window:
        h = safe_float(r['high'])
        l = safe_float(r['low'])
        c = safe_float(r['close'])
        v = safe_float(r['volume'])
        if h <= 0 or l <= 0 or c <= 0 or v <= 0:
            continue
        # OHLC sanity (BRAVO-1 data-quality fix): لو high<close أو low>close
        # نعتبر البيانات فاسدة ونستخدم close لكليهما (conservative flat).
        if h < c or l > c or l > h:
            h, l = c, c
        valid.append((h, l, c, v))

    if len(valid) < MFI_PERIOD + 1:
        return 50.0

    tps = [(h + l + c) / 3.0 for h, l, c, v in valid]
    rmfs = [tps[i] * valid[i][3] for i in range(len(valid))]

    pos_mf = 0.0
    neg_mf = 0.0
    for i in range(1, len(valid)):
        if tps[i] > tps[i - 1]:
            pos_mf += rmfs[i]
        elif tps[i] < tps[i - 1]:
            neg_mf += rmfs[i]

    if pos_mf == 0 and neg_mf == 0:
        return 50.0  # لا تذبذب → محايد
    if neg_mf == 0:
        return 100.0
    if pos_mf == 0:
        return 0.0

    ratio = pos_mf / neg_mf
    mfi = 100.0 - (100.0 / (1.0 + ratio))
    return round(mfi, 2)


# ─────────────────────────────────────────────────────────────────────────────
# Feature 4: atr_ratio = ATR(14) / close * 100
# ─────────────────────────────────────────────────────────────────────────────
def compute_atr_ratio(
    prior_rows: List[sqlite3.Row], close_at_signal: Optional[float]
) -> float:
    """ATR(14) = متوسط True Range لـ 14 يوم. atr_ratio = ATR / close * 100.

    True Range = max(high - low, |high - prev_close|, |low - prev_close|).

    Fallback: لو لا توجد بيانات كافية → 0.
    """
    if close_at_signal is None or close_at_signal <= 0:
        return 0.0
    if len(prior_rows) < ATR_PERIOD + 1:
        return 0.0

    window = prior_rows[-(ATR_PERIOD + 1):]
    trs: List[float] = []
    for i in range(1, len(window)):
        prev_close = safe_float(window[i - 1]['close'])
        if prev_close <= 0:
            continue
        curr_high = safe_float(window[i]['high'])
        curr_low = safe_float(window[i]['low'])
        if curr_high <= 0:
            curr_high = prev_close
        if curr_low <= 0:
            curr_low = prev_close
        # OHLC sanity.
        if curr_high < prev_close:
            curr_high = prev_close
        if curr_low > prev_close:
            curr_low = prev_close
        tr = max(
            curr_high - curr_low,
            abs(curr_high - prev_close),
            abs(curr_low - prev_close),
        )
        trs.append(tr)

    if len(trs) < ATR_PERIOD:
        return 0.0
    atr = sum(trs[-ATR_PERIOD:]) / ATR_PERIOD
    return round((atr / close_at_signal) * 100.0, 4)


# ─────────────────────────────────────────────────────────────────────────────
# Feature 5: wyckoff_score (مؤشر مركّب 0-100)
# ─────────────────────────────────────────────────────────────────────────────
def _avg_atr_close_ratio(rows: List[sqlite3.Row]) -> Optional[float]:
    """متوسط (TR / prev_close) لقائمة صفوف — للاستخدام في price_compression."""
    if len(rows) < 2:
        return None
    ratios: List[float] = []
    for i in range(1, len(rows)):
        prev_close = safe_float(rows[i - 1]['close'])
        if prev_close <= 0:
            continue
        curr_high = safe_float(rows[i]['high'])
        curr_low = safe_float(rows[i]['low'])
        if curr_high <= 0:
            curr_high = prev_close
        if curr_low <= 0:
            curr_low = prev_close
        if curr_high < prev_close:
            curr_high = prev_close
        if curr_low > prev_close:
            curr_low = prev_close
        tr = max(
            curr_high - curr_low,
            abs(curr_high - prev_close),
            abs(curr_low - prev_close),
        )
        ratios.append(tr / prev_close)
    if not ratios:
        return None
    return sum(ratios) / len(ratios)


def compute_wyckoff_score(prior_rows: List[sqlite3.Row]) -> float:
    """مؤشر مركّب 0-100 (50 = محايد، > 50 = تجميع، < 50 = تصريف).

    المكونات (كل واحد 25 نقطة):
      1. volume_trend       : هل الحجم يزداد في آخر 10 أيام؟ (1/0)
      2. price_compression  : هل ATR/close يضيق (آخر 5 < آخر 20)؟ (1/0)
      3. close_vs_ma20      : هل |close - MA20|/MA20 < 0.03؟ (1/0)
      4. accumulation_score : نسبة الأيام الإيجابية (close > open) آخر 20 يوم (0-1)

    Fallback: لو لا توجد بيانات كافية → 50 (محايد).
    """
    if len(prior_rows) < WYCKOFF_LOOKBACK:
        return 50.0

    last_20 = prior_rows[-WYCKOFF_LOOKBACK:]
    last_10 = last_20[-10:]
    last_5 = last_20[-5:]

    # 1) volume_trend: متوسط النصف الثاني > متوسط النصف الأول؟
    vols_10 = [parse_num(r['volume']) for r in last_10 if parse_num(r['volume']) > 0]
    if len(vols_10) >= 6:
        half = len(vols_10) // 2
        first_half = sum(vols_10[:half]) / half if half else 0
        second_half = sum(vols_10[half:]) / (len(vols_10) - half)
        volume_trend = 1 if second_half > first_half else 0
    else:
        volume_trend = 0

    # 2) price_compression: ATR/close لآخر 5 < ATR/close لآخر 20؟
    atr5 = _avg_atr_close_ratio(last_5)
    atr20 = _avg_atr_close_ratio(last_20)
    if atr5 is not None and atr20 is not None:
        price_compression = 1 if atr5 < atr20 else 0
    else:
        price_compression = 0

    # 3) close_vs_ma20: |close - MA20|/MA20 < 0.03؟
    closes_20 = [safe_float(r['close']) for r in last_20 if safe_float(r['close']) > 0]
    if len(closes_20) >= 5:
        ma20 = sum(closes_20) / len(closes_20)
        close_last = closes_20[-1]
        close_vs_ma20 = 1 if (ma20 > 0 and abs(close_last - ma20) / ma20 < 0.03) else 0
    else:
        close_vs_ma20 = 0

    # 4) accumulation_score: نسبة الأيام الإيجابية (close > open) آخر 20 يوم.
    pos_days = 0
    valid_days = 0
    for r in last_20:
        o = safe_float(r['open'])
        c = safe_float(r['close'])
        if o > 0 and c > 0:
            valid_days += 1
            if c > o:
                pos_days += 1
    accumulation_score = (pos_days / valid_days) if valid_days > 0 else 0.5

    score = (
        volume_trend * 25.0
        + price_compression * 25.0
        + close_vs_ma20 * 25.0
        + accumulation_score * 25.0
    )
    return round(score, 2)


# ─────────────────────────────────────────────────────────────────────────────
# Feature 6: distance_to_ma20 = (close - MA20) / MA20 * 100
# ─────────────────────────────────────────────────────────────────────────────
def compute_distance_to_ma20(
    prior_rows: List[sqlite3.Row], close_at_signal: Optional[float]
) -> Optional[float]:
    """المسافة من MA20 كنسبة مئوية. موجب = فوق MA20، سالب = تحته.

    MA20 = متوسط close لـ 20 يوم قبل signal_date.
    """
    closes = [safe_float(r['close']) for r in prior_rows if safe_float(r['close']) > 0]
    if len(closes) < MA_PERIOD or close_at_signal is None or close_at_signal <= 0:
        return None
    ma20 = sum(closes[-MA_PERIOD:]) / MA_PERIOD
    if ma20 <= 0:
        return None
    return round(((close_at_signal - ma20) / ma20) * 100.0, 4)


# ─────────────────────────────────────────────────────────────────────────────
# تجميع الـ features لإشارة واحدة
# ─────────────────────────────────────────────────────────────────────────────
def extract_features_for_signal(
    conn: sqlite3.Connection,
    signal: sqlite3.Row,
    market_dist_cache: Dict[str, Dict[str, float]],
) -> Optional[Dict[str, Optional[float]]]:
    """احسب الـ 6 features لإشارة واحدة. يُرجع None لو لا توجد بيانات كافية أساسية."""
    ticker = signal['ticker']
    signal_date = signal['signal_date']

    # cache توزيع السوق per signal_date (5 تواريخ فقط → cache صغير).
    if signal_date not in market_dist_cache:
        market_dist_cache[signal_date] = compute_market_distribution(conn, 'EGX', signal_date)
    distribution = market_dist_cache[signal_date]

    # 1) percentile_rank.
    avg_to = compute_avg_turnover_20d(conn, ticker, signal_date)
    percentile_rank = percentile_rank_in_distribution(distribution, avg_to)

    # جلب آخر 30 يوم قبل signal_date (للمؤشرات السعرية).
    prior_rows = fetch_prior_prices(conn, ticker, signal_date, n=30)
    if not prior_rows:
        return None
    close_at_signal = safe_float(prior_rows[-1]['close'])
    if close_at_signal <= 0:
        return None

    # 2) rvol_20d (استعلام منفصل لـ today_volume لضمان الدقة).
    rvol_20d = compute_rvol_20d(conn, ticker, signal_date)

    # 3) mfi_14.
    mfi_14 = compute_mfi_14(prior_rows)

    # 4) atr_ratio.
    atr_ratio = compute_atr_ratio(prior_rows, close_at_signal)

    # 5) wyckoff_score.
    wyckoff_score = compute_wyckoff_score(prior_rows)

    # 6) distance_to_ma20.
    distance_to_ma20 = compute_distance_to_ma20(prior_rows, close_at_signal)

    return {
        'percentile_rank': percentile_rank,
        'rvol_20d': rvol_20d,
        'mfi_14': mfi_14,
        'atr_ratio': atr_ratio,
        'wyckoff_score': wyckoff_score,
        'distance_to_ma20': distance_to_ma20,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Purged Time-Series Split
# ─────────────────────────────────────────────────────────────────────────────
def purged_time_series_split(
    dates: List[str],
    train_ratio: float = TRAIN_RATIO,
    purge_gap_days: int = PURGE_GAP_DAYS,
    min_train_after_purge: int = MIN_TRAIN_AFTER_PURGE,
) -> Tuple[int, int, Dict[str, Any]]:
    """تقسيم زمني مع purge gap.

    1. ترتيب الإشارات بـ signal_date تصاعديًا (مفترض مسبقًا).
    2. إيجاد split_idx عند حد تاريخي (date boundary) أقرب ما يكون إلى train_ratio.
    3. تطبيق purge: إسقاط إشارات train التي تقع ضمن purge_gap_days (calendar)
       من test_start_date — لمنع تسريب الـ labels.
    4. لو الـ purge سيُفرغ train (أقل من min_train_after_purge) → تخطّيه مع WARNING.

    Returns:
        (split_idx, purged_count, meta_dict)
    """
    n = len(dates)
    if n < 2:
        return n, 0, {'warning': 'insufficient data'}

    target = int(train_ratio * n)

    # candidate splits عند حدود التواريخ (date boundaries).
    candidate_splits = [i for i in range(1, n) if dates[i - 1] != dates[i]]
    if not candidate_splits:
        # كل الإشارات في نفس اليوم — لا يمكن split زمني حقيقي.
        return n, 0, {'warning': 'all signals on same date'}

    # اختر أقرب حد للـ target.
    split_idx = min(candidate_splits, key=lambda i: abs(i - target))

    # تطبيق purge: إسقاط train signals ذات signal_date >= test_start - purge_gap_days.
    test_start_str = dates[split_idx]
    try:
        test_start = date.fromisoformat(test_start_str)
    except ValueError:
        return split_idx, 0, {'warning': f'bad date: {test_start_str}'}
    cutoff = test_start - timedelta(days=purge_gap_days)
    cutoff_str = cutoff.isoformat()

    new_split = split_idx
    for i in range(split_idx):
        if dates[i] >= cutoff_str:
            new_split = i
            break

    purged_count = split_idx - new_split

    # حماية: لو الـ purge سيُفرغ train → تخطّيه.
    if new_split < min_train_after_purge:
        return split_idx, 0, {
            'warning': (
                f'purge of {purge_gap_days} days would leave only {new_split} '
                f'train signals (< {min_train_after_purge}); purge skipped'
            )
        }

    return new_split, purged_count, {}


# ─────────────────────────────────────────────────────────────────────────────
# التقرير المُنسّق
# ─────────────────────────────────────────────────────────────────────────────
def fmt_pct(x: float, digits: int = 2) -> str:
    return f'{x:.{digits}f}%'


def print_report(
    total_signals: int,
    valid_signals: int,
    dropped_signals: int,
    wins: int,
    losses: int,
    importance_pairs: List[Tuple[str, float]],
    train_size: int,
    test_size: int,
    train_dates: Tuple[Optional[str], Optional[str]],
    test_dates: Tuple[Optional[str], Optional[str]],
    purge_info: Dict[str, Any],
    purged_count: int,
    baseline_win_rate: float,
    accepted_count: int,
    coverage: float,
    precision: float,
    recall: float,
    accuracy: float,
    improvement: float,
    cm: np.ndarray,
    model_path: Path,
    model_size_kb: float,
) -> None:
    win_pct = (wins / valid_signals * 100) if valid_signals else 0.0
    loss_pct = (losses / valid_signals * 100) if valid_signals else 0.0

    train_range_str = f'{train_dates[0]} → {train_dates[1]}' if train_dates[0] else 'N/A'
    test_range_str = f'{test_dates[0]} → {test_dates[1]}' if test_dates[0] else 'N/A'

    tn, fp, fn, tp = int(cm[0, 0]), int(cm[0, 1]), int(cm[1, 0]), int(cm[1, 1]) if cm.size == 4 else (0, 0, 0, 0)

    print()
    print('=' * 60)
    print('LGBM Signal Gatekeeper — Training Report')
    print('=' * 60)
    print()
    print('=== DATA ===')
    print(f'Total signals: {total_signals}')
    print(f'Valid signals: {valid_signals}')
    print(f'Dropped (NaN): {dropped_signals}')
    print(f'Class balance: {fmt_pct(win_pct)} win / {fmt_pct(loss_pct)} loss')
    print()
    print('=== FEATURES ===')
    print(f'{len(FEATURE_NAMES)} features: {", ".join(FEATURE_NAMES)}')
    print('Feature importance:')
    for i, (fname, imp) in enumerate(importance_pairs, 1):
        print(f'  {i}. {fname}: {int(imp) if imp == int(imp) else imp}')
    print()
    print('=== PURGED TIME-SERIES SPLIT ===')
    print(f'Train: {train_size} signals ({train_range_str})')
    print(f'Test:  {test_size} signals ({test_range_str})')
    print(f'Purge gap: {PURGE_GAP_DAYS} trading days (calendar fallback)')
    if purge_info.get('warning'):
        print(f'  ⚠️ PURGE WARNING: {purge_info["warning"]}')
    if purged_count > 0:
        print(f'  Purged train signals (within gap): {purged_count}')
    print()
    print('=== BASELINE (before filter) ===')
    print(f'Win Rate (test set): {fmt_pct(baseline_win_rate)}')
    print()
    print(f'=== AFTER LGBM FILTER (proba >= {PROBA_THRESHOLD}) ===')
    print(f'Accepted signals: {accepted_count} / {test_size} (coverage: {fmt_pct(coverage)})')
    print(f'Precision (Win Rate of accepted): {fmt_pct(precision)}')
    print(f'Recall: {fmt_pct(recall)}')
    print(f'Accuracy: {fmt_pct(accuracy)}')
    sign = '+' if improvement >= 0 else ''
    print(f'Improvement: {sign}{fmt_pct(improvement)} percentage points')
    print()
    print('=== CONFUSION MATRIX ===')
    print('              Predicted Loss  Predicted Win')
    print(f'Actual Loss        {tn:<12}  {fp}')
    print(f'Actual Win         {fn:<12}  {tp}')
    print()
    print('=== MODEL SAVED ===')
    print(f'Path: models/{model_path.name}')
    print(f'Size: {model_size_kb:.1f} KB')
    print()
    print('=' * 60)


# ─────────────────────────────────────────────────────────────────────────────
# Main pipeline
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    print(f'[LGBM] DB: {DB_PATH}')
    print(f'[LGBM] Model output: {MODEL_PATH}')
    print(f'[LGBM] LightGBM {lgb.__version__} | numpy {np.__version__}')

    # 1) فتح DB للقراءة فقط.
    conn = open_db_readonly()

    # 2) استخراج الإشارات الموثّقة من radar_signal_tracking.
    rows = conn.execute(
        """
        SELECT id, ticker, signal_date, signal_type, entry_price, status
        FROM radar_signal_tracking
        WHERE status IN ('verified_win', 'verified_loss')
        ORDER BY signal_date ASC, ticker ASC
        """
    ).fetchall()
    total_signals = len(rows)
    print(f'[LGBM] Loaded {total_signals} verified signals from radar_signal_tracking.')

    # 3) استخراج الـ features لكل إشارة.
    market_dist_cache: Dict[str, Dict[str, float]] = {}
    features_list: List[List[float]] = []
    labels_list: List[int] = []
    meta_list: List[Dict[str, Any]] = []

    for i, r in enumerate(rows):
        if i % 50 == 0:
            print(f'[LGBM]   features {i}/{total_signals} ...')
        try:
            feat = extract_features_for_signal(conn, r, market_dist_cache)
        except Exception as e:
            print(f'[LGBM]   ⚠️ signal {r["ticker"]} {r["signal_date"]} error: {e}')
            continue
        if feat is None:
            continue
        # التحقق من الـ features الأساسية — لا None مسموح (Rule 27).
        if any(feat[k] is None for k in CRITICAL_FEATURES):
            continue
        # التحقق من NaN/Inf.
        row_vec = [float(feat[k]) for k in FEATURE_NAMES]
        if any((not math.isfinite(v)) for v in row_vec):
            continue
        features_list.append(row_vec)
        labels_list.append(1 if r['status'] == 'verified_win' else 0)
        meta_list.append({
            'id': r['id'],
            'ticker': r['ticker'],
            'signal_date': r['signal_date'],
            'status': r['status'],
        })

    conn.close()

    valid_signals = len(features_list)
    dropped_signals = total_signals - valid_signals
    wins = sum(labels_list)
    losses = valid_signals - wins

    if valid_signals < MIN_VALID_SIGNALS:
        print(f'[LGBM] ⚠️ WARNING: only {valid_signals} valid signals '
              f'(< {MIN_VALID_SIGNALS}). Proceeding anyway.')

    if valid_signals < 10:
        print(f'[LGBM] ❌ too few valid signals ({valid_signals}). abort.')
        return 1

    X = np.array(features_list, dtype=float)
    y = np.array(labels_list, dtype=int)
    dates = [m['signal_date'] for m in meta_list]

    print(f'[LGBM] Valid signals: {valid_signals} (wins={wins}, losses={losses}).')

    # 4) Purged Time-Series Split (chronological + 5-day purge gap).
    split_idx, purged_count, purge_info = purged_time_series_split(
        dates,
        train_ratio=TRAIN_RATIO,
        purge_gap_days=PURGE_GAP_DAYS,
        min_train_after_purge=MIN_TRAIN_AFTER_PURGE,
    )
    if purge_info.get('warning'):
        print(f'[LGBM] ⚠️ purge: {purge_info["warning"]}')

    X_train, y_train = X[:split_idx], y[:split_idx]
    X_test, y_test = X[split_idx:], y[split_idx:]
    train_size = len(X_train)
    test_size = len(X_test)
    train_dates_range = (dates[0], dates[split_idx - 1]) if split_idx > 0 else (None, None)
    test_dates_range = (dates[split_idx], dates[-1]) if split_idx < len(dates) else (None, None)

    print(f'[LGBM] Split: train={train_size} ({train_dates_range[0]} → {train_dates_range[1]}), '
          f'test={test_size} ({test_dates_range[0]} → {test_dates_range[1]}), '
          f'purged={purged_count}')

    if train_size < 20 or test_size < 10:
        print(f'[LGBM] ❌ insufficient train/test sizes. abort.')
        return 1

    # 5) تدريب النموذج.
    print(f'[LGBM] Training LGBMClassifier with params: {LGBM_PARAMS}')
    model = lgb.LGBMClassifier(**LGBM_PARAMS)
    model.fit(X_train, y_train)

    # 6) التقييم.
    baseline_win_rate = float(y_test.mean() * 100.0) if test_size else 0.0
    proba = model.predict_proba(X_test)[:, 1]
    accepted_mask = proba >= PROBA_THRESHOLD
    accepted_count = int(accepted_mask.sum())
    coverage = (accepted_count / test_size * 100.0) if test_size else 0.0

    if accepted_count > 0:
        y_pred = accepted_mask.astype(int)
        precision = precision_score(y_test, y_pred, zero_division=0) * 100.0
        recall = recall_score(y_test, y_pred, zero_division=0) * 100.0
        accuracy = accuracy_score(y_test, y_pred) * 100.0
    else:
        precision = 0.0
        recall = 0.0
        accuracy = 0.0

    improvement = precision - baseline_win_rate

    # confusion matrix على test set باستخدام عتبة proba كـ prediction.
    cm = confusion_matrix(y_test, accepted_mask.astype(int), labels=[0, 1])

    # Feature importance.
    importances = model.feature_importances_
    importance_pairs = sorted(zip(FEATURE_NAMES, importances), key=lambda x: -x[1])

    # 7) حفظ النموذج + feature_names + metadata.
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    save_payload = {
        'model': model,
        'feature_names': FEATURE_NAMES,
        'prob': PROBA_THRESHOLD,
        'lgbm_params': LGBM_PARAMS,
        'trained_at': datetime.now().isoformat(timespec='seconds'),
        'n_train': train_size,
        'n_test': test_size,
        'train_date_range': list(train_dates_range),
        'test_date_range': list(test_dates_range),
        'baseline_win_rate': baseline_win_rate,
        'precision_at_threshold': precision,
        'coverage': coverage,
        'sklearn_version': __import__('sklearn').__version__,
        'lightgbm_version': lgb.__version__,
    }
    joblib.dump(save_payload, MODEL_PATH, compress=3)
    model_size_kb = MODEL_PATH.stat().st_size / 1024.0

    # 8) طباعة التقرير.
    print_report(
        total_signals=total_signals,
        valid_signals=valid_signals,
        dropped_signals=dropped_signals,
        wins=wins,
        losses=losses,
        importance_pairs=importance_pairs,
        train_size=train_size,
        test_size=test_size,
        train_dates=train_dates_range,
        test_dates=test_dates_range,
        purge_info=purge_info,
        purged_count=purged_count,
        baseline_win_rate=baseline_win_rate,
        accepted_count=accepted_count,
        coverage=coverage,
        precision=precision,
        recall=recall,
        accuracy=accuracy,
        improvement=improvement,
        cm=cm,
        model_path=MODEL_PATH,
        model_size_kb=model_size_kb,
    )

    # خلاصة سريعة للـ CI.
    print(f'[LGBM] DONE. baseline={fmt_pct(baseline_win_rate)} '
          f'precision@{PROBA_THRESHOLD}={fmt_pct(precision)} '
          f'coverage={fmt_pct(coverage)} '
          f'model_size={model_size_kb:.1f}KB')

    return 0


if __name__ == '__main__':
    sys.exit(main())

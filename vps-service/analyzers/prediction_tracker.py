"""
Prediction Tracker
==================
نظام تتبع وتسجيل التوقعات لحساب الدقة الحقيقية

هذا النظام يسجل:
1. كل توقع صادر من النظام
2. السعر وقت التوقع
3. النتيجة بعد فترة محددة
4. نسبة النجاح الفعلية

Author: دليل الاستثمار
"""

import sqlite3
import json
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from contextlib import contextmanager

# Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
try:
    from core.db_manager import db_manager as _dbm
    _PRED_TRACKER_DBM_AVAILABLE = True
except Exception as _pt_err:
    _PRED_TRACKER_DBM_AVAILABLE = False
    print(f"[PredictionTracker] db_manager not available ({_pt_err}) — falling back to raw sqlite3")


@contextmanager
def _open_db(db_path: str, writable: bool = False):
    """Rule 54 / Phase 3: استخدم db_manager.connection() مع fallback sqlite3.connect.

    Args:
        db_path: مسار الـ DB على القرص (ممكن يكون predictions.db أو stocks.db —
                 db_manager بيتعامل مع الـ absolute path مباشرة).
        writable: True للكتابة (WAL + busy_timeout)، False للقراءة فقط.

    Yields:
        sqlite3.Connection — بيستخدم raw sqlite3.connect عادي (بدون row_factory=Row)
        عشان الكود الموجود بـ يستخدم index-based access (row[0], row[1], ...).
        db_manager بـ يضيف row_factory=Row تلقائياً، و Row بـ يدعم index access
        زي tuples بالظبط، فمفيش مشكلة backward compat.
    """
    ctx = None
    conn = None
    try:
        if _PRED_TRACKER_DBM_AVAILABLE:
            ctx = _dbm.connection(db_path, writable=writable)
            conn = ctx.__enter__()
        else:
            raise RuntimeError("db_manager unavailable")
    except Exception:
        # fallback: raw sqlite3.connect (backward compat)
        conn = sqlite3.connect(db_path, timeout=30.0)
        try:
            conn.execute('PRAGMA busy_timeout=30000')
            if writable:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA synchronous=NORMAL')
        except Exception:
            pass
        ctx = None
    try:
        yield conn
    finally:
        try:
            if ctx is not None:
                ctx.__exit__(None, None, None)
            else:
                conn.close()
        except Exception:
            pass

# v3.29.0: Holiday-aware prediction dates — prevents predictions on Fri/Sat/holidays
try:
    from utils.trading_calendar import get_prediction_date_str, is_trading_day
except ImportError:
    def get_prediction_date_str(dt=None, market='EGX'):
        return (dt or datetime.now()).strftime('%Y-%m-%d')
    def is_trading_day(dt=None, market='EGX'):
        return (dt or datetime.now()).weekday() not in [4, 5]

# DATA-QUALITY (W1–W9): write-time rejection من data_quality_rules.
# يمنع إعادة التسمم من المصدر (entry≤0, target≤0, stop≤0, inverted direction,
# R:R≤0, extreme deviations). الـ maestro guards (1ب/1ج/ATR) بـ تعدّل قبل ما
# يوصلوا هنا، فالـ W rules دي = خط الدفاع الأخير لو أي caller bypass.
try:
    import sys as _sys
    from pathlib import Path as _Path
    _SCRIPTS_DIR = str(_Path(__file__).resolve().parent.parent.parent / 'scripts')
    if _SCRIPTS_DIR not in _sys.path:
        _sys.path.insert(0, _SCRIPTS_DIR)
    from data_quality_rules import validate_write as _validate_write_pred
    _DATA_QUALITY_AVAILABLE = True
except Exception as _dq_err:
    _DATA_QUALITY_AVAILABLE = False
    _validate_write_pred = None
    print(f"[PredictionTracker] data_quality_rules unavailable (W-guards disabled): {_dq_err}", flush=True)


# ════════════════════════════════════════════════════════════════════════════
# MASTER DIRECTIVE — المحور 3: حراسة هندسة الأسعار الصارمة (Hard Geometry Gate)
# ───────────────────────────────────────────────────────────────────────────────
# يمنع الأهداف الوهمية المعكوسة + الأوقاف الهزلية + تلوث تجزئات الأسهم.
# السبب الجذري لـ win rate 35.4% / PF=0.248 / -1616% تراكمي:
#   1) target <= entry  (هندسة معكوسة — SCTS entry=614 target=608)
#   2) stop  >= entry    (هندسة معكوسة)
#   3) stop  <= entry×0.10 (وقف هزلي — MFPC entry=37.22 stop=0.37؛ SCTS stop=40.50)
#   4) target > entry×3.0 (تلوث تجزئة — BTFH entry=3.12 target=1392؛ HELI target=937)
#   5) R/R < 1.5          (مخاطرة كبيرة مقابل ربح تافه — +0.11% win vs -15% loss)
#
# 🔥 الاستراتيجية الجديدة: HARD REJECT (مش AUTO-FIX)
#   - قبل كده كان AUTO-FIX بـ يحوّل target/stop لـ entry×1.05 / entry×0.95.
#   - النتيجة: الصفقة اتسجلت بـ target وهمي مش مربوط بـ تحليل فني → ربح +0.11%.
#   - دلوقتي: أي صفقة بـ تخالف القواعد دي بـ تتـ REJECT نهائيًا (ترجع None).
#   - ده بـ يقلل عدد التوقعات بس بـ يرفع جودتها: كل صفقة مسجّلة بـ R/R ≥ 1.5.
#
# القواعد الصارمة (بتطبّق على BUY/STRONG_BUY/ACCUMULATE):
#   R1: target <= entry × 1.05                  → REJECT (ربح أقل من 5%)
#   R2: stop   >= entry × 0.95                  → REJECT (وقف أقل من 5%)
#   R3: stop   <= entry × 0.93                  → REJECT (وقف أوسع من 7% — خسارة قاتلة)
#   R4: target >  entry × 3.0                   → REJECT (هدف خيالي — تلوث تجزئة)
#   R5: R/R    <  2.0                            → REJECT (مخاطرة غير مجدية — لازم 2:1)
# ════════════════════════════════════════════════════════════════════════════
# ⚡ TIGHTENED (Aug 2026): الـ diagnostic أظهر avg loss -13.15% بسبب أوقاف واسعة.
#   - R2 من 0.97 لـ 0.95 (وقف ≥ 5% — حماية أقوى)
#   - R3 من 0.90 لـ 0.91 (وقف ≤ 9% — matching atr_stop_max_pct=9.0)
#   - R5 من 1.5 لـ 2.0 (R/R لازم ≥ 2:1 — مخاطرة مجدية)
# النتيجة المتوقعة: avg loss ≤ -9%, win rate أعلى, profit factor > 1.0
# FIX (2026-08-28): R3 كان 0.93 (7%) لكن atr_stop_max_pct=9.0 — ده كان بيرفض
# كل الأسهم القيادية والانفجارية (TMGH, BIOC, NIPH, AFMC, ESRS كلها stop=9%).
_GEOMETRY_TARGET_MIN_MULT   = 1.05   # R1: target لازم > entry × 1.05 (ربح ≥ 5%)
_GEOMETRY_STOP_MAX_MULT      = 0.95   # R2: stop لازم < entry × 0.95 (وقف ≤ 5%)
_GEOMETRY_STOP_MIN_MULT      = 0.905  # R3: stop لازم > entry × 0.905 (وقف ≤ 9.5% — matching atr_stop_max_pct=9.0 + floating point margin)
_GEOMETRY_TARGET_MAX_MULT    = 3.0    # R4: target لازم ≤ entry × 3.0 (منع تلوث التجزئة)
_GEOMETRY_MIN_RR             = 1.5    # R5: R/R لازم ≥ 1.5 (matching dynamic_rr_normal — was 2.0, too strict)
# FIX (2026-08-28): كان 2.0 لكن engine_settings dynamic_rr_normal=1.5.
# الـ 2.0 كان بيرفض صفقات R/R=1.997 (مثل TMGH) بدون سبب حقيقي.


def enforce_geometry_guard(signal, entry_price, target_price, stop_loss):
    """حراسة هندسة الأسعار الصارمة — MASTER DIRECTIVE المحور 3 (HARD REJECT).

    للـ BUY/STRONG_BUY/ACCUMULATE: يفحص 5 قواعد صارمة. لو أي قاعدة فشلت →
    AssertionError بيطلع والـ caller (record_prediction) بـ يعمل REJECT (ترجع None).

    للـ SELL/غيرها: مرّر زي ما هو (البيع ليه هندسة معكوسة).

    القواعد (R1-R5) — TIGHTENED Aug 2026:
        R1: target > entry × 1.05   (ربح ≥ 5%)
        R2: stop  < entry × 0.95    (وقف ≥ 5%)
        R3: stop  > entry × 0.93    (وقف ≤ 7% — منع الأوقاف الواسعة القاتلة)
        R4: target ≤ entry × 3.0    (منع تلوث التجزئة — أهداف خيالية)
        R5: R/R  ≥ 2.0              (مخاطرة مجدية — لازم 2:1)

    Returns:
        (target_price, stop_loss, warning: str|None) — القيم زي ما هي لو success.
    Raises:
        AssertionError: لو أي قاعدة فشلت (الـ caller بـ يعمل REJECT).
    """
    sig = (signal or '').upper().strip()
    is_buy = sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE')
    if not is_buy:
        return target_price, stop_loss, None

    entry = float(entry_price or 0)
    target = float(target_price or 0)
    stop = float(stop_loss or 0)

    if entry <= 0:
        # entry غير صالح — REJECT (مش نقبل صفقة بدون سعر دخول)
        raise AssertionError(
            f"R0: entry_price={entry} <= 0 — سعر دخول غير صالح"
        )

    # R1: target لازم > entry × 1.05 (ربح ≥ 5%)
    # boundary: target = entry×1.05 (exactly 5%) مقبول
    if target < entry * _GEOMETRY_TARGET_MIN_MULT:
        raise AssertionError(
            f"R1: target={target:.4f} < entry×1.05={entry*_GEOMETRY_TARGET_MIN_MULT:.4f} "
            f"(ربح < 5% — هدف تافه)"
        )

    # R2: stop لازم < entry × 0.95 (وقف ≥ 5%)
    # boundary: stop = entry×0.95 (exactly 5% protection) مقبول
    # Task FINALIZE-UNIFICATION (Rule 27 — NO-FAKE-DATA):
    # Previously R2 had an AUTO-ADJUST path that fabricated stop=entry*0.945
    # and target=entry + MIN_RR*(entry-stop) when the original stop was too
    # tight (stop > entry*0.95). This contradicted the documented HARD-REJECT
    # strategy (line 115: "🔥 الاستراتيجية الجديدة: HARD REJECT (مش AUTO-FIX)")
    # and violated Rule 27 (recording fabricated target/stop instead of real
    # analyzer-computed values). Now: HARD REJECT via AssertionError (same
    # as R1/R3/R4/R5) — the caller (record_prediction) returns None and the
    # trade is NOT recorded. This is honest per Rule 27 + Rule 35.
    _geo_warn = None
    if stop > entry * _GEOMETRY_STOP_MAX_MULT:
        raise AssertionError(
            f"R2: stop={stop:.4f} >= entry×0.95={entry*_GEOMETRY_STOP_MAX_MULT:.4f} "
            f"(وقف < 5% — حماية غير كافية. AUTO-ADJUST removed per Rule 27 FINALIZE-UNIFICATION.)"
        )

    # R3: stop لازم > entry × 0.91 (وقف ≤ 9% — matching atr_stop_max_pct=9.0)
    # boundary: stop = entry×0.91 (exactly 9%) مقبول
    # FIX (2026-08-28): كان 0.93 (7%) لكن atr_stop_max_pct=9.0 — ده كان بيرفض
    # كل الأسهم القيادية والانفجارية (التذبذب المصري عالي → ATR=9% طبيعي).
    if stop < entry * _GEOMETRY_STOP_MIN_MULT:
        raise AssertionError(
            f"R3: stop={stop:.4f} < entry×0.91={entry*_GEOMETRY_STOP_MIN_MULT:.4f} "
            f"(وقف > 9% — خسارة قاتلة / تلوث تجزئة)"
        )

    # R4: target لازم ≤ entry × 3.0 (منع تلوث التجزئة — أهداف خيالية)
    if target > entry * _GEOMETRY_TARGET_MAX_MULT:
        raise AssertionError(
            f"R4: target={target:.4f} > entry×3.0={entry*_GEOMETRY_TARGET_MAX_MULT:.4f} "
            f"(هدف خيالي — تلوث تجزئة الأسهم)"
        )

    # R5: R/R لازم ≥ 2.0 (مخاطرة مجدية — لازم 2:1)
    # Rule 54: استخدم canonical compute_risk_reward
    try:
        from utils.risk_reward import compute_risk_reward
        rr = compute_risk_reward(entry, target, stop, fallback=0.0)
    except Exception:
        risk = entry - stop
        reward = target - entry
        if risk <= 0:
            raise AssertionError(
                f"R5: risk={risk:.4f} <= 0 (entry={entry} stop={stop} — هندسة معكوسة)"
            )
        rr = round(reward / risk, 2)
    if rr <= 0:
        raise AssertionError(
            f"R5: R/R={rr:.3f} <= 0 (entry={entry} stop={stop} — هندسة معكوسة)"
        )
    if rr < _GEOMETRY_MIN_RR:
        raise AssertionError(
            f"R5: R/R={rr:.3f} < {_GEOMETRY_MIN_RR} "
            f"(entry={entry} target={target} stop={stop} — مخاطرة غير مجدية، لازم 2:1)"
        )

    return target, stop, _geo_warn


@dataclass
class Prediction:
    """Data class for a prediction record."""
    id: Optional[int] = None
    ticker: str = ''
    signal: str = ''
    signal_type: str = ''  # BUY, ACCUMULATE, HOLD, REDUCE, SELL
    
    # At prediction time
    prediction_date: str = ''
    entry_price: float = 0.0
    target_price: float = 0.0
    stop_loss: float = 0.0
    master_score: float = 0.0
    
    # Analysis components — Optional[float] = None (FIX-2 Rule 24 + owner directive):
    #   was `= 50.0` placeholder (misleading — implies we have score data and it's
    #   neutral 50). Now None = honest "no data available". The predictions table
    #   allows NULL (column is `REAL DEFAULT 50` — DEFAULT only applies when column
    #   is OMITTED from INSERT, but we always pass it explicitly, so None → NULL).
    technical_score: Optional[float] = None
    fundamental_score: Optional[float] = None
    ai_pattern_score: Optional[float] = None
    sentiment_score: Optional[float] = None
    
    # Outcome (filled later)
    outcome_date: str = ''
    exit_price: float = 0.0
    actual_return: float = 0.0
    hit_target: bool = False
    hit_stop: bool = False
    is_correct: Optional[bool] = None
    
    # Metadata
    holding_days: int = 0
    notes: str = ''


class PredictionTracker:
    """
    متتبع التوقعات
    
    يحسب الدقة الحقيقية للنظام:
    - Win Rate: نسبة التوقعات الصحيحة
    - Avg Return: متوسط العائد
    - Best/Worst cases
    """
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._init_table()
    
    def _init_table(self):
        """Initialize predictions table with auto-migration for missing columns."""
        # Rule 54 / Phase 3: استخدم db_manager.connection(writable=True) — fallback sqlite3.connect
        with _open_db(self.db_path, writable=True) as conn:
            cursor = conn.cursor()

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS predictions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    signal TEXT NOT NULL,
                    signal_type TEXT NOT NULL,

                    prediction_date TEXT NOT NULL,
                    entry_price REAL NOT NULL,
                    target_price REAL,
                    stop_loss REAL,
                    master_score REAL,

                    technical_score REAL DEFAULT 50,
                    fundamental_score REAL DEFAULT 50,
                    ai_pattern_score REAL DEFAULT 50,
                    sentiment_score REAL DEFAULT 50,

                    outcome_date TEXT,
                    exit_price REAL,
                    actual_return REAL,
                    hit_target INTEGER DEFAULT 0,
                    hit_stop INTEGER DEFAULT 0,
                    is_correct INTEGER,

                    holding_days INTEGER DEFAULT 0,
                    notes TEXT,

                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Auto-migration: add missing columns if the table already existed with old schema
            existing_cols = {row[1] for row in cursor.execute("PRAGMA table_info(predictions)").fetchall()}
            migrations = [
                ("signal_type",       "TEXT NOT NULL DEFAULT 'BUY'"),
                ("technical_score",   "REAL DEFAULT 50"),
                ("fundamental_score", "REAL DEFAULT 50"),
                ("ai_pattern_score",  "REAL DEFAULT 50"),
                ("sentiment_score",   "REAL DEFAULT 50"),
                ("actual_return",     "REAL"),
                ("hit_target",        "INTEGER DEFAULT 0"),
                ("hit_stop",          "INTEGER DEFAULT 0"),
                ("is_correct",        "INTEGER"),
                ("holding_days",      "INTEGER DEFAULT 0"),
                ("highest_price_reached", "REAL"),
                ("lowest_price_reached",  "REAL"),
                # RL-FIX-18: T1/T2 multi-target + explosive flag
                # المالك: "هدف أول وثانى عالشان لو السهم ناوى يطير ميضعش من أدينا"
                ("target_price_2",        "REAL DEFAULT 0"),
                ("explosive_score",       "REAL DEFAULT 0"),
                ("explosive_label",       "TEXT DEFAULT ''"),
                # V40.1: Evidence-based prediction tracking
                ("evidence_count",        "INTEGER DEFAULT 0"),  # V40: عدد الأدلة المتوافقة (0-6)
                ("morning_bell",          "INTEGER DEFAULT 0"),  # V40.1: جرس الصباح = أعلى ثقة + ربحية (0/1)
                ("kill_filter_result",    "TEXT DEFAULT ''"),    # V40: نتيجة Kill Filters
                # P0 FIX (V402-DIAGNOSIS R5+R6, 2026-10-07): risk_reward + who_is_buying
                # كانوا محسوبين في daily_predictor.py لكن غير مكتوبين في DB → None/—
                ("risk_reward",           "REAL"),               # P0: R:R ratio (مطابقة V40.2)
                ("who_is_buying",         "TEXT DEFAULT ''"),     # P0: "🏦 شراء مؤسساتي" / "👤 شراء أفراد" (mirror Pine L669-763)
                # PREDICTION-STORE-FIX (2026-10-18): persona + atr_at_entry columns
                # record_prediction() بيمرر persona='balanced' + atr_at_entry بس الـ table مفيهمش.
                # ده كان بيسبب "Store error: table predictions has no column named persona".
                ("persona",               "TEXT DEFAULT 'balanced'"),  # 'gambler' | 'balanced' | 'conservative'
                ("atr_at_entry",          "REAL"),               # PHASE-1C: ATR(14) وقت الدخول
            ]
            for col_name, col_def in migrations:
                if col_name not in existing_cols:
                    try:
                        cursor.execute(f"ALTER TABLE predictions ADD COLUMN {col_name} {col_def}")
                        print(f"[PredictionTracker] Migration: added column '{col_name}' to predictions table")
                    except Exception as e:
                        print(f"[PredictionTracker] Migration warning for '{col_name}': {e}")

            conn.commit()
    
    def record_prediction(
        self,
        ticker: str,
        signal: str,
        entry_price: float,
        target_price: float = None,
        stop_loss: float = None,
        master_score: float = None,
        technical_score: Optional[float] = None,
        fundamental_score: Optional[float] = None,
        ai_pattern_score: Optional[float] = None,
        sentiment_score: Optional[float] = None,
        notes: str = '',
        persona: str = 'balanced',
        atr_at_entry: float = None,
        target_price_2: float = None,
        explosive_score: float = 0.0,
        explosive_label: str = '',
        prediction_date: str = None,
        evidence_count: int = 0,
        morning_bell: int = 0,
        kill_filter_result: str = '',
        risk_reward: Optional[float] = None,           # P0 FIX (V402-DIAGNOSIS R5)
        who_is_buying_state: str = '',                 # P0 FIX (V402-DIAGNOSIS R6)
    ) -> int:
        """
        Record a new prediction.

        Args:
            persona: 'gambler' | 'balanced' | 'conservative' — الشخصية اللي أصدرت
                     التوقع. بتتكتب في عمود persona عشان شاشة متابعة التوقعات
                     تقدر تقسّم الأداء لكل شخصية على حدة. لو مش محدد → 'balanced'.
            atr_at_entry: قيمة ATR(14) وقت الدخول (للـ trailing stop + القياس الدائم).
                     PHASE-1C: بـ يتكتب في عمود atr_at_entry لو موجود.
            target_price_2: الهدف الثاني (T2) لـ multi-target exit. لو موجود →
                     الـ daily_closer Rule 1.7/1.8 بـ يرفع الـ target لـ T2 بعد
                     ما T1 يتضرب + زخم قوي، ويـ exit عند T2 بـ `target_2_hit`.
                     ده بيحقق أعلى مكسب من الأسهم الانفجارية.
            explosive_score: درجة الانفجارية (0-100) من explosive_scanner.
                     لو >= 50 (SPARK/ROCKET/BOMB) → الـ daily_closer بـ يطبّق
                     trailing stop أقرب (1.5×ATR بدل 2.5×) عشان يلحق السهم يطير.
            explosive_label: 'BOMB' | 'ROCKET' | 'SPARK' | '' — تصنيف السهم.

        Returns:
            int: Prediction ID
        """
        # Determine signal type
        if signal in ['STRONG_BUY', 'BUY']:
            signal_type = 'BUY'
        elif signal == 'ACCUMULATE':
            signal_type = 'ACCUMULATE'
        elif signal == 'HOLD':
            signal_type = 'HOLD'
        elif signal == 'REDUCE':
            signal_type = 'REDUCE'
        else:
            signal_type = 'SELL'

        # Normalize persona to the 3 canonical values
        _persona = (persona or 'balanced').strip().lower()
        if _persona == 'investor':
            _persona = 'conservative'  # alias
        if _persona not in ('gambler', 'balanced', 'conservative'):
            _persona = 'balanced'

        # ── MASTER DIRECTIVE المحور 3: حراسة هندسة الأسعار (Geometry Guard) ──
        # Task FINALIZE-UNIFICATION (Rule 27 — NO-FAKE-DATA):
        # Previously the comment here described an AUTO-FIX path that
        # fabricated target=entry*1.05 / stop=entry*0.95 when the analyzer's
        # values violated the geometry rules. The AUTO-FIX was REMOVED in
        # enforce_geometry_guard (see lines 187-203 above) — now all R1-R5
        # violations result in HARD REJECT (return None). This aligns with
        # the documented strategy (line 115: "HARD REJECT مش AUTO-FIX") and
        # Rule 27 (NO-FAKE-DATA) + Rule 35 (V40.2 is the only writer).
        try:
            _geo_target, _geo_stop, _geo_warn = enforce_geometry_guard(
                signal, entry_price, target_price, stop_loss,
            )
            if _geo_warn:
                print(
                    f"[GEOMETRY-GUARD] ticker={ticker} signal={signal} "
                    f"entry={entry_price} | {_geo_warn}",
                    flush=True,
                )
                target_price = _geo_target
                stop_loss = _geo_stop
        except AssertionError as _geo_assert:
            # الـ assert بـ يعمل crash لو الـ AUTO-FIX فشل (ده bug حرج).
            # بدل ما نكسر المحرك، نـ reject الصفقة + log.
            print(
                f"[GEOMETRY-REJECT] ticker={ticker} signal={signal} "
                f"entry={entry_price} target={target_price} stop={stop_loss} "
                f"| {_geo_assert}",
                flush=True,
            )
            return None

        # ── DATA-QUALITY (W1–W9): write-time rejection ──────────────────────
        # آخر خط دفاع قبل INSERT. لو أي قاعدة اشتعلت → لا حفظ + log [PRED_REJECT].
        # الـ maestro guards (1ب/1ج/ATR) بـ تعدّل target/stop قبل ما يوصلوا هنا،
        # فالـ W rules دي بـ تلتقط بس اللي فات (أو callers تانيين bypass).
        if _DATA_QUALITY_AVAILABLE and _validate_write_pred is not None:
            _ok, _code, _reason = _validate_write_pred(
                signal, entry_price, target_price, stop_loss,
            )
            if not _ok:
                print(
                    f"[PRED_REJECT] ticker={ticker} signal={signal} "
                    f"{_code}: {_reason} "
                    f"(entry={entry_price} target={target_price} stop={stop_loss})",
                    flush=True,
                )
                return None

        # ── RL-FIX-17 (OWNER-MANDATE): 5 توقعات بحد أقصى + dedup ───────────
        # المالك: "عدد الأسهم لا يزيد عن خمس توقعات بحد أقصى". قبل كده أي تحليل
        # كان بـ يـ INSERT مباشرة → تراكم 44 توقع معلق في DB → تشويش العميل.
        # القواعد الجديدة:
        #   1. DEDUP (ticker, persona): لو السهم موجود في PENDING لنفس persona →
        #      تحديث target/stop/score بدل تكرار صف جديد (يمنع ARVA duplicate).
        #   2. CAP: لو PENDING للـ persona >= 5 → رفض الـ INSERT (silently).
        #      المجموع الأقصى = 15 (5 لكل persona × 3 personas).
        #   3. الـ cap بـ يـ skip بس التوقعات اللي جاية من الـ background cycle
        #      (multi-ticker scan). الـ manual single-ticker analysis بـ يـ bypass
        #      عشان الأدمن يقدر يفرض توقع لسهم معين.
        _MAX_PENDING_PER_PERSONA = int(os.environ.get('MAX_PENDING_PER_PERSONA', '5'))
        _BYPASS_CAP = os.environ.get('BYPASS_PRED_CAP', '').lower() in ('1', 'true', 'yes')

        # ═══════════════════════════════════════════════════════════════════════
        # BRAVO-KILL-CRITERIA (2026-10-19): Kill Criteria الجديد (per Mohsen's directive)
        # Risk Kill: MaxDD > 15% → إيقاف فوري (block insert)
        # Warning Zone: PF < 1.0 بعد 30 صفقة → warning (log only, no block)
        # Performance Kill: PF < 0.9 بعد 50 صفقة AND شهرين → block insert
        # Market Context Override: لو EGX30 نزل > 5% في الشهر → defer Performance Kill
        # ═══════════════════════════════════════════════════════════════════════
        _RISK_KILL_DD = 15.0
        _PERF_KILL_PF = 0.9
        _PERF_KILL_MIN_TRADES = 50
        _PERF_KILL_MIN_MONTHS = 2
        _WARNING_PF = 1.0
        _WARNING_MIN_TRADES = 30

        try:
            with _open_db(self.db_path, writable=True) as _kill_conn:
                _kill_cur = _kill_conn.cursor()
                _kill_rows = _kill_cur.execute("""
                    SELECT actual_return, created_at FROM predictions
                    WHERE status IN ('TARGET_HIT', 'STOPPED')
                    AND actual_return IS NOT NULL AND actual_return != 0
                    AND actual_return != 50.0
                    ORDER BY created_at DESC LIMIT 100
                """).fetchall()
                if len(_kill_rows) >= _WARNING_MIN_TRADES:
                    _positive = 0.0
                    _negative = 0.0
                    _months = set()
                    for _r in _kill_rows:
                        _ret = float(_r[0] or 0)
                        if _ret > 0:
                            _positive += _ret
                        else:
                            _negative += abs(_ret)
                        _created = str(_r[1] or '')
                        if len(_created) >= 7:
                            _months.add(_created[:7])
                    _pf = _positive / _negative if _negative > 0 else 0.0
                    _n = len(_kill_rows)
                    _nm = len(_months)

                    # Risk Kill: MaxDD > 15% → immediate block
                    _equity = 100.0
                    _peak = 100.0
                    _max_dd = 0.0
                    for _r in _kill_rows:
                        _ret = float(_r[0] or 0)
                        _equity += _ret * 0.025  # position size 2.5%
                        if _equity > _peak:
                            _peak = _equity
                        _dd = (_peak - _equity) / _peak * 100 if _peak > 0 else 0
                        if _dd > _max_dd:
                            _max_dd = _dd
                    if _max_dd >= _RISK_KILL_DD:
                        print(f"[KILL-RISK] MaxDD={_max_dd:.1f}% >= {_RISK_KILL_DD}% → INSERT blocked", flush=True)
                        return None

                    # Warning Zone (log only — no block)
                    if _pf < _WARNING_PF:
                        print(f"[KILL-WARNING] PF={_pf:.2f} < {_WARNING_PF} after {_n} trades — warning only", flush=True)

                    # Performance Kill (with Market Context Override)
                    if (_n >= _PERF_KILL_MIN_TRADES
                            and _nm >= _PERF_KILL_MIN_MONTHS
                            and _pf < _PERF_KILL_PF):
                        _defer_kill = False
                        try:
                            _ph_db_path = os.path.join(os.path.dirname(self.db_path), 'price_history.db')
                            if os.path.exists(_ph_db_path):
                                _ph_c = sqlite3.connect(_ph_db_path)
                                _ph_c.row_factory = sqlite3.Row
                                _now = datetime.now()
                                _month_start = _now.strftime('%Y-%m-01')
                                _today = _now.strftime('%Y-%m-%d')
                                _comi = _ph_c.execute(
                                    "SELECT date, close_price FROM price_history "
                                    "WHERE ticker = 'COMI' AND date >= ? AND date <= ? "
                                    "ORDER BY date",
                                    (_month_start, _today)
                                ).fetchall()
                                if len(_comi) >= 2 and _comi[0]['close_price'] and float(_comi[0]['close_price']) > 0:
                                    _egx_ret = ((float(_comi[-1]['close_price']) - float(_comi[0]['close_price']))
                                                / float(_comi[0]['close_price'])) * 100
                                    if _egx_ret < -5.0:
                                        _defer_kill = True
                                        print(f"[KILL-DEFER] Performance Kill deferred — EGX30={_egx_ret:.1f}% < -5% (Market Context Override)", flush=True)
                                _ph_c.close()
                        except Exception:
                            pass  # safe-by-design

                        if not _defer_kill:
                            print(f"[KILL-PERF] PF={_pf:.2f} < {_PERF_KILL_PF} after {_n} trades + {_nm} months → INSERT blocked", flush=True)
                            return None
        except Exception:
            pass  # safe-by-design

        if not _BYPASS_CAP:
            try:
                # Rule 54 / Phase 3: استخدم db_manager.connection(writable=True) — fallback sqlite3.connect
                with _open_db(self.db_path, writable=True) as _chk_conn:
                    _chk_cur = _chk_conn.cursor()

                    # (1) DEDUP: check existing PENDING for same (ticker, persona)
                    _existing = _chk_cur.execute(
                        "SELECT id FROM predictions WHERE ticker = ? AND persona = ? "
                        "AND outcome_date IS NULL ORDER BY created_at DESC LIMIT 1",
                        (ticker, _persona)
                    ).fetchone()

                    if _existing:
                        _existing_id = _existing['id']
                        # Update instead of insert — keep the latest analysis
                        # RL-FIX-18: include target_price_2 + explosive fields in dedup-UPDATE
                        try:
                            _chk_cur.execute('''
                                UPDATE predictions SET
                                    signal = ?, signal_type = ?,
                                    entry_price = ?, target_price = ?, stop_loss = ?,
                                    master_score = ?, updated_at = ?,
                                    technical_score = ?, fundamental_score = ?,
                                    ai_pattern_score = ?, sentiment_score = ?,
                                    notes = ?, atr_at_entry = ?,
                                    target_price_2 = ?, explosive_score = ?, explosive_label = ?
                                WHERE id = ?
                            ''', (
                                signal, signal_type,
                                entry_price, target_price, stop_loss,
                                master_score, datetime.now().isoformat(),
                                technical_score, fundamental_score,
                                ai_pattern_score, sentiment_score,
                                notes, atr_at_entry,
                                target_price_2 or 0, explosive_score or 0.0, explosive_label or '',
                                _existing_id
                            ))
                            _chk_conn.commit()
                            print(
                                f"[PRED_DEDUP_UPDATE] ticker={ticker} persona={_persona} "
                                f"existing_id={_existing_id} → updated (no duplicate insert) "
                                f"T2={target_price_2 or 0} expl={explosive_label or '-'}/{explosive_score or 0}",
                                flush=True
                            )
                        except Exception as _upde:
                            # لو العمود مش موجود (schema قديم) → fallback بدون atr_at_entry/T2
                            _chk_cur.execute('''
                                UPDATE predictions SET
                                    signal = ?, signal_type = ?,
                                    entry_price = ?, target_price = ?, stop_loss = ?,
                                    master_score = ?, updated_at = ?,
                                    technical_score = ?, fundamental_score = ?,
                                    ai_pattern_score = ?, sentiment_score = ?,
                                    notes = ?
                                WHERE id = ?
                            ''', (
                                signal, signal_type,
                                entry_price, target_price, stop_loss,
                                master_score, datetime.now().isoformat(),
                                technical_score, fundamental_score,
                                ai_pattern_score, sentiment_score,
                                notes, _existing_id
                            ))
                            _chk_conn.commit()
                        return _existing_id

                    # (2) CAP: count PENDING for this persona
                    _pending_count = _chk_cur.execute(
                        "SELECT COUNT(*) FROM predictions WHERE persona = ? "
                        "AND outcome_date IS NULL",
                        (_persona,)
                    ).fetchone()[0]

                if _pending_count >= _MAX_PENDING_PER_PERSONA:
                    print(
                        f"[PRED_CAP_SKIP] ticker={ticker} persona={_persona} "
                        f"pending={_pending_count} >= cap={_MAX_PENDING_PER_PERSONA} "
                        f"→ INSERT rejected (5-max rule)",
                        flush=True
                    )
                    return None
            except Exception as _cap_err:
                # safe fallback: لا نكسر الإنتاج لو الـ cap check فشل
                print(
                    f"[PRED_CAP_WARN] cap check failed ({_cap_err}) → proceeding with INSERT",
                    flush=True
                )

        # Rule 54 / Phase 3: استخدم db_manager.connection(writable=True) — fallback sqlite3.connect.
        # ملاحظة: بنفتح الـ connection بدون `with` عشان الـ function طويلة وفيها multiple
        # cursor.execute/conn.commit/conn.close — استدعاء conn.close() في النهاية
        # بيشتغل على المسارين (sqlite3.Connection.close() idempotent).
        _rec_pred_ctx = None
        try:
            if _PRED_TRACKER_DBM_AVAILABLE:
                _rec_pred_ctx = _dbm.connection(self.db_path, writable=True)
                conn = _rec_pred_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(self.db_path)
            _rec_pred_ctx = None
        cursor = conn.cursor()

        # P2-CREATED_AT-FIX (v3.69.0): اكتب created_at كـ ISO timestamp حقيقي
        _pred_date_for_created = prediction_date if prediction_date else get_prediction_date_str(datetime.now())
        _created_at_iso = _pred_date_for_created + 'T09:00:00.000000'
        # PHASE-1C: اكتب atr_at_entry لو موجود (للـ trailing + القياس الدائم).
        # safe insert: لو العمود مش موجود في schema قديم، الـ try بـ يـ fallback
        # للـ INSERT الـ 15-column القديم.
        # RL-FIX-18: normalize T2 + explosive fields
        _target_price_2 = float(target_price_2) if target_price_2 else 0.0
        _explosive_score = float(explosive_score) if explosive_score else 0.0
        _explosive_label = (explosive_label or '').strip().upper()
        # V40.1: prediction_date override (for historical generation) + evidence fields
        _pred_date = prediction_date if prediction_date else get_prediction_date_str(datetime.now())
        _evidence_count = int(evidence_count) if evidence_count else 0
        _morning_bell = 1 if morning_bell else 0
        _kill_filter_result = (kill_filter_result or '').strip()

        try:
            cursor.execute('''
                INSERT INTO predictions (
                    ticker, signal, signal_type,
                    prediction_date, entry_price, target_price, stop_loss, master_score,
                    technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                    notes, persona, created_at, atr_at_entry,
                    target_price_2, explosive_score, explosive_label,
                    evidence_count, morning_bell, kill_filter_result,
                    risk_reward, who_is_buying
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                ticker, signal, signal_type,
                _pred_date,
                entry_price, target_price, stop_loss, master_score,
                technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                notes, _persona,
                _created_at_iso,
                atr_at_entry,
                _target_price_2, _explosive_score, _explosive_label,
                _evidence_count, _morning_bell, _kill_filter_result,
                risk_reward, who_is_buying_state,
            ))
        except Exception as _primary_err:
            # BRAVO-LOG-EXCEPT (2026-10-19): كان الـ except بـ يبتلع الـ exception
            # بصمت. ده خفى مشكلة حقيقية: الـ INSERT الأول بـ يفشل بسبب DEV-13
            # trigger (لو prices = NaN/None/<=0)، والـ fallback بـ يكتب بدون
            # risk_reward → 145 توقع بـ R/R=None في الـ DB.
            # دلوقتي بنـ log الـ exception الحقيقي عشان نـعرف السبب.
            print(
                f"[PRED-TRACKER-PRIMARY-FAIL] ticker={ticker} signal={signal} "
                f"entry={entry_price} target={target_price} stop={stop_loss} "
                f"score={master_score} R/R={risk_reward} | "
                f"{type(_primary_err).__name__}: {_primary_err}",
                flush=True,
            )
            # fallback: schema قديم مفيهوش atr_at_entry/T2 columns
            # BRAVO-FIX (2026-10-19): ضفنا risk_reward + evidence_count + morning_bell
            # + kill_filter_result + who_is_buying + target_price_2 في الـ fallback
            # عشان لو الـ INSERT الأول فشل، الـ fields المهمة مـتـكتبة (مش NULL).
            try:
                cursor.execute('''
                    INSERT INTO predictions (
                        ticker, signal, signal_type,
                        prediction_date, entry_price, target_price, stop_loss, master_score,
                        technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                        notes, persona, created_at, atr_at_entry,
                        target_price_2, explosive_score, explosive_label,
                        evidence_count, morning_bell, kill_filter_result,
                        risk_reward, who_is_buying
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    ticker, signal, signal_type,
                    get_prediction_date_str(datetime.now()),
                    entry_price, target_price, stop_loss, master_score,
                    technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                    notes, _persona,
                    _created_at_iso,
                    atr_at_entry,
                    _target_price_2, _explosive_score, _explosive_label,
                    _evidence_count, _morning_bell, _kill_filter_result,
                    risk_reward, who_is_buying_state,
                ))
            except Exception as _fallback_err:
                # BRAVO-LOG-EXCEPT: log الـ fallback exception كمان
                print(
                    f"[PRED-TRACKER-FALLBACK-FAIL] ticker={ticker} signal={signal} "
                    f"| {type(_fallback_err).__name__}: {_fallback_err}",
                    flush=True,
                )
                # fallback 2: أقدم schema (بدون risk_reward — last resort)
                cursor.execute('''
                    INSERT INTO predictions (
                        ticker, signal, signal_type,
                        prediction_date, entry_price, target_price, stop_loss, master_score,
                        technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                        notes, persona, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    ticker, signal, signal_type,
                    get_prediction_date_str(datetime.now()),
                    entry_price, target_price, stop_loss, master_score,
                    technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                    notes, _persona,
                    _created_at_iso,
                ))

        pred_id = cursor.lastrowid
        conn.commit()
        conn.close()

        return pred_id
    
    def update_outcome(
        self,
        prediction_id: int,
        exit_price: float,
        notes: str = ''
    ) -> Dict:
        """
        Update prediction with actual outcome.
        
        Returns:
            Dict: Updated prediction with results
        """
        # Rule 54 / Phase 3: استخدم db_manager.connection(writable=True) — fallback sqlite3.connect
        _uo_ctx = None
        try:
            if _PRED_TRACKER_DBM_AVAILABLE:
                _uo_ctx = _dbm.connection(self.db_path, writable=True)
                conn = _uo_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(self.db_path)
            _uo_ctx = None
        cursor = conn.cursor()
        
        # Get original prediction
        cursor.execute('''
            SELECT prediction_date, entry_price, target_price, stop_loss, signal_type
            FROM predictions WHERE id = ?
        ''', (prediction_id,))
        row = cursor.fetchone()
        
        if not row:
            conn.close()
            return {'error': 'Prediction not found'}
        
        pred_date_str, entry_price, target_price, stop_loss, signal_type = row
        
        # Calculate results
        actual_return = (exit_price - entry_price) / entry_price * 100 if entry_price > 0 else 0
        
        # Parse prediction date
        try:
            pred_date = datetime.strptime(pred_date_str, '%Y-%m-%d %H:%M:%S')
            holding_days = (datetime.now() - pred_date).days
        except:
            holding_days = 0
        
        # Determine if prediction was correct
        hit_target = False
        hit_stop = False
        is_correct = None
        
        if target_price and exit_price >= target_price:
            hit_target = True
        if stop_loss and exit_price <= stop_loss:
            hit_stop = True
        
        # For BUY signals: correct if price went up
        # For SELL signals: correct if price went down
        if signal_type in ['BUY', 'ACCUMULATE']:
            is_correct = actual_return > 0
        elif signal_type in ['SELL', 'REDUCE']:
            is_correct = actual_return < 0
        
        # Update database
        cursor.execute('''
            UPDATE predictions SET
                outcome_date = ?,
                exit_price = ?,
                actual_return = ?,
                hit_target = ?,
                hit_stop = ?,
                is_correct = ?,
                holding_days = ?,
                notes = COALESCE(notes || ' | ' || ?, ?)
            WHERE id = ?
        ''', (
            datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            exit_price,
            actual_return,
            1 if hit_target else 0,
            1 if hit_stop else 0,
            1 if is_correct else 0 if is_correct is not None else None,
            holding_days,
            notes, notes,
            prediction_id
        ))
        
        conn.commit()
        conn.close()
        
        return {
            'prediction_id': prediction_id,
            'exit_price': exit_price,
            'actual_return': actual_return,
            'is_correct': is_correct,
            'holding_days': holding_days
        }

    def set_verified_outcome(
        self,
        prediction_id: int,
        outcome_date: str,
        exit_price: float,
        actual_return: float,
        hit_target: int,
        hit_stop: int,
        is_correct: int,
        holding_days: int,
        exit_reason: str = '',
    ) -> bool:
        """
        V40.1: Store a pre-verified outcome for a historical prediction.
        Used by the V40 historical generator which computes outcomes via simulate_trade.
        Unlike update_outcome, this accepts all fields explicitly (no datetime.now()).

        BUGFIX (2026-09-02): exit_reason wasn't being written to the exit_type column
        (it was only going into notes). This caused every backtest prediction to have
        exit_type=NULL. Now we write exit_type explicitly.
        """
        try:
            # Rule 54 / Phase 3: استخدم db_manager.connection(writable=True) — fallback sqlite3.connect
            _svo_ctx = None
            try:
                if _PRED_TRACKER_DBM_AVAILABLE:
                    _svo_ctx = _dbm.connection(self.db_path, writable=True)
                    conn = _svo_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
                _svo_ctx = None
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE predictions SET
                    outcome_date = ?,
                    exit_price = ?,
                    actual_return = ?,
                    hit_target = ?,
                    hit_stop = ?,
                    is_correct = ?,
                    holding_days = ?,
                    exit_type = ?,
                    status = 'closed',
                    notes = COALESCE(notes || ' | ' || ?, ?)
                WHERE id = ?
            ''', (
                outcome_date, exit_price, actual_return,
                hit_target, hit_stop, is_correct, holding_days,
                exit_reason,
                exit_reason, exit_reason, prediction_id,
            ))
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"[set_verified_outcome] error for id={prediction_id}: {e}", flush=True)
            return False

    # ========================================================================
    # REALITY-CHECK-023: Open Trades Tracking (تتبع التوقعات المفتوحة)
    # ========================================================================
    # أي توقع يتكتب، لازم يفضل مفتوح (PENDING) لحد ما يوصل الـ TP أو الـ SL.
    # لو وصل TP1 وكمل صعود → "توقع ناجح، السهم كمل زخم".
    # لو فشل (ضرب SL) → يتسجل في learned_lessons عشان العقل يتعلم منه.
    # ========================================================================

    def get_open_predictions(self, ticker: str = None, limit: int = 50) -> List[Dict]:
        """
        جلب كل التوقعات المفتوحة (PENDING).

        Args:
            ticker: لو موجود، بيرجع بس توقعات السهم ده
            limit: حد أقصى عدد التوقعات

        Returns:
            List[Dict]: التوقعات المفتوحة
        """
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _gop_ctx = None
        try:
            if _PRED_TRACKER_DBM_AVAILABLE:
                _gop_ctx = _dbm.connection(self.db_path)
                conn = _gop_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(self.db_path)
            _gop_ctx = None
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            if ticker:
                cursor.execute('''
                    SELECT * FROM predictions
                    WHERE outcome_date IS NULL AND ticker = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                ''', (ticker, limit))
            else:
                cursor.execute('''
                    SELECT * FROM predictions
                    WHERE outcome_date IS NULL
                    ORDER BY created_at DESC
                    LIMIT ?
                ''', (limit,))
            rows = cursor.fetchall()
            return [dict(r) for r in rows]
        except Exception as e:
            print(f"[PredictionTracker] get_open_predictions error: {e}")
            return []
        finally:
            conn.close()

    def track_momentum(self, prediction_id: int, current_price: float) -> Dict:
        """
        تتبع الزخم بعد ما التوقع يوصل TP1.

        القاعدة:
        - لو التوقع وصل TP1 (target_price) والسهم كمل صعود فوق TP1
          → نرجّع "توقع ناجح، السهم كمل زخم" مع نسبة الربح الإضافية
        - لو التوقف وصل TP1 لكن رجع تحت TP1
          → نرجّع "توقع نجح بس فقد الزخم" (تحذير)
        - لو لسه ملوصلش TP1 → "جاري التنفيذ"

        Args:
            prediction_id: ID التوقع
            current_price: السعر الحالي للسهم

        Returns:
            Dict: {status, momentum_status, extra_return, message}
        """
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _tm_ctx = None
        try:
            if _PRED_TRACKER_DBM_AVAILABLE:
                _tm_ctx = _dbm.connection(self.db_path, writable=True)
                conn = _tm_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(self.db_path)
            _tm_ctx = None
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            cursor.execute('''
                SELECT ticker, entry_price, target_price, stop_loss, signal_type,
                       highest_price_reached, lowest_price_reached, outcome_date
                FROM predictions WHERE id = ?
            ''', (prediction_id,))
            row = cursor.fetchone()

            if not row:
                return {'status': 'error', 'message': 'Prediction not found'}

            entry_price = float(row['entry_price'] or 0)
            target_price = float(row['target_price'] or 0)
            highest = float(row['highest_price_reached'] or 0)
            # P6-PREDICTIONS: parallel tracking لأقل سعر للصفقات البيعية
            try:
                lowest = float(row['lowest_price_reached'] or 0)
            except (KeyError, IndexError, TypeError):
                lowest = 0.0
            _sig_type = (row['signal_type'] or 'BUY').upper()

            # P6-PREDICTIONS: للصفقات البيعية (SELL/REDUCE)، الهدف تحت والوقف فوق
            # فبنتابع lowest_price_reached لتحقيق الهدف.
            if _sig_type in ('SELL', 'REDUCE'):
                if target_price <= 0 or lowest <= 0 or lowest > target_price:
                    return {
                        'status': 'pending',
                        'momentum_status': 'جاري التنفيذ',
                        'extra_return': 0.0,
                        'message': f'السهم لسه ملوصلش الهدف ({lowest:.2f} / {target_price:.2f})'
                    }
            else:
                # لو التوقع لسه مفتوح وموصلش target (BUY/ACCUMULATE)
                if target_price <= 0 or highest < target_price:
                    return {
                        'status': 'pending',
                        'momentum_status': 'جاري التنفيذ',
                        'extra_return': 0.0,
                        'message': f'السهم لسه ملوصلش الهدف ({highest:.2f} / {target_price:.2f})'
                    }

            # التوقع وصل الهدف — نتابع الزخم
            extra_return = ((current_price - target_price) / target_price * 100) if target_price > 0 else 0

            if current_price > target_price * 1.02:  # كمل صعود أكتر من 2% فوق الهدف
                return {
                    'status': 'momentum_continued',
                    'momentum_status': '🚀 توقع ناجح، السهم كمل زخم',
                    'extra_return': round(extra_return, 2),
                    'message': f'السهم كمل صعود {extra_return:.1f}% فوق الهدف — زخم قوي'
                }
            elif current_price >= target_price * 0.98:  # ثابت حوالين الهدف
                return {
                    'status': 'momentum_stable',
                    'momentum_status': '✅ توقع ناجح، السهم ثابت عند الهدف',
                    'extra_return': round(extra_return, 2),
                    'message': 'السهم وصل الهدف وثبت — خذ ربحك'
                }
            else:  # رجع تحت الهدف بعد ما وصله
                return {
                    'status': 'momentum_lost',
                    'momentum_status': '⚠️ توقع نجح بس فقد الزخم',
                    'extra_return': round(extra_return, 2),
                    'message': f'السهم وصل الهدف لكن رجع {abs(extra_return):.1f}% — خذ حذر'
                }

        except Exception as e:
            return {'status': 'error', 'message': str(e)}
        finally:
            conn.close()

    def learn_from_failure(self, prediction_id: int, failure_reason: str = '') -> Dict:
        """
        تعلّم من التوقعات الفاشلة — يكتب في learned_lessons.

        FIX (Phase 2, 2026-08-21): This function previously used a DIFFERENT schema
        (ticker, signal_type, failure_pattern, ...) than the actual learned_lessons
        table (lesson_type, condition, outcome, ...). The INSERT silently failed
        with "table learned_lessons has no column named ticker".

        Now delegates to lesson_store.record_lesson_from_close() which uses the
        CORRECT schema and is the canonical writer for learning data.

        Args:
            prediction_id: ID التوقع الفاشل
            failure_reason: سبب الفشل (اختياري)

        Returns:
            Dict: نتيجة التعلّم
        """
        try:
            from utils.lesson_store import record_lesson_from_close
        except ImportError:
            try:
                import sys, os
                sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
                from utils.lesson_store import record_lesson_from_close
            except ImportError as ie:
                return {'status': 'error', 'message': f'Cannot import lesson_store: {ie}'}

        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _lff_ctx = None
        try:
            if _PRED_TRACKER_DBM_AVAILABLE:
                _lff_ctx = _dbm.connection(self.db_path)
                conn = _lff_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(self.db_path)
            _lff_ctx = None
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            # جلب تفاصيل التوقع الفاشل
            cursor.execute('''
                SELECT ticker, signal_type, entry_price, target_price, stop_loss,
                       master_score, technical_score, fundamental_score,
                       actual_return, holding_days, prediction_date,
                       persona, morning_bell, market, atr_at_entry
                FROM predictions WHERE id = ?
            ''', (prediction_id,))
            pred = cursor.fetchone()

            if not pred:
                return {'status': 'error', 'message': 'Prediction not found'}

            actual_return = float(pred['actual_return'] or 0)
            holding_days = int(pred['holding_days'] or 0)
            entry_price = float(pred['entry_price'] or 0)
            stop_loss = float(pred['stop_loss'] or 0)
            target_price = float(pred['target_price'] or 0)
            atr_at_entry = float(pred['atr_at_entry'] or 0)

            # تحديد persona للدرس
            persona = str(pred['persona'] or 'balanced')

            # استخدام lesson_store الكنوني (نفس schema الـ table الفعلي)
            lesson_code = record_lesson_from_close(
                ticker=str(pred['ticker'] or ''),
                persona=persona,
                exit_type='stop_loss',
                actual_return=actual_return,
                holding_days=holding_days,
                entry_price=entry_price,
                stop_loss=stop_loss,
                target_price=target_price,
                atr_at_entry=atr_at_entry,
            )

            return {
                'status': 'learned',
                'lesson_code': lesson_code,
                'prediction_id': prediction_id,
                'failure_reason': failure_reason,
                'ticker': str(pred['ticker'] or ''),
                'actual_return': actual_return,
                'holding_days': holding_days,
            }

        except Exception as e:
            return {'status': 'error', 'message': str(e)}
        finally:
            conn.close()

    def get_accuracy_stats(self, days: int = 30) -> Dict:
        """
        Get accuracy statistics for the last N days.
        
        Args:
            days: Number of days to look back
            
        Returns:
            Dict: Accuracy statistics
        """
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _gas_ctx = None
        try:
            if _PRED_TRACKER_DBM_AVAILABLE:
                _gas_ctx = _dbm.connection(self.db_path)
                conn = _gas_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(self.db_path)
            _gas_ctx = None
        cursor = conn.cursor()
        
        since_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        
        # Total predictions
        cursor.execute('''
            SELECT COUNT(*) FROM predictions
            WHERE prediction_date >= ?
        ''', (since_date,))
        total_predictions = cursor.fetchone()[0]

        # Predictions with outcomes
        cursor.execute('''
            SELECT COUNT(*) FROM predictions
            WHERE prediction_date >= ? AND is_correct IS NOT NULL
        ''', (since_date,))
        evaluated = cursor.fetchone()[0]
        
        # Correct predictions
        cursor.execute('''
            SELECT COUNT(*) FROM predictions
            WHERE prediction_date >= ? AND is_correct = 1
        ''', (since_date,))
        correct = cursor.fetchone()[0]
        
        # By signal type
        cursor.execute('''
            SELECT signal_type, COUNT(*), SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END)
            FROM predictions
            WHERE prediction_date >= ? AND is_correct IS NOT NULL
            GROUP BY signal_type
        ''', (since_date,))
        by_type = {row[0]: {'total': row[1], 'correct': row[2]} for row in cursor.fetchall()}
        
        # Average return
        cursor.execute('''
            SELECT AVG(actual_return), MIN(actual_return), MAX(actual_return)
            FROM predictions
            WHERE prediction_date >= ? AND actual_return IS NOT NULL
        ''', (since_date,))
        ret_row = cursor.fetchone()
        avg_return = ret_row[0] or 0
        min_return = ret_row[1] or 0
        max_return = ret_row[2] or 0
        
        conn.close()
        
        win_rate = (correct / evaluated * 100) if evaluated > 0 else 0
        
        return {
            'period_days': days,
            'total_predictions': total_predictions,
            'evaluated': evaluated,
            'pending': total_predictions - evaluated,
            'correct': correct,
            'incorrect': evaluated - correct,
            'win_rate': round(win_rate, 2),
            'avg_return': round(avg_return, 2),
            'min_return': round(min_return, 2),
            'max_return': round(max_return, 2),
            'by_signal_type': by_type
        }
    
    def get_pending_predictions(self) -> List[Prediction]:
        """Get predictions that haven't been evaluated yet."""
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _gpp_ctx = None
        try:
            if _PRED_TRACKER_DBM_AVAILABLE:
                _gpp_ctx = _dbm.connection(self.db_path)
                conn = _gpp_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(self.db_path)
            _gpp_ctx = None
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, ticker, signal, signal_type, prediction_date, entry_price,
                   target_price, stop_loss, master_score
            FROM predictions
            WHERE is_correct IS NULL
            ORDER BY prediction_date DESC
        ''')
        
        rows = cursor.fetchall()
        conn.close()
        
        predictions = []
        for row in rows:
            predictions.append(Prediction(
                id=row[0],
                ticker=row[1],
                signal=row[2],
                signal_type=row[3],
                prediction_date=row[4],
                entry_price=row[5],
                target_price=row[6],
                stop_loss=row[7],
                master_score=row[8]
            ))
        
        return predictions
    
    def batch_record_predictions(self, analysis_results: List[Dict]) -> int:
        """
        Record multiple predictions from analysis results.
        
        Args:
            analysis_results: List of MasterAnalysis.to_dict() results
            
        Returns:
            int: Number of predictions recorded
        """
        count = 0
        for result in analysis_results:
            if result.get('is_tradeable') and result.get('signal') not in ['EXCLUDED', 'INSUFFICIENT_DATA']:
                risk = result.get('risk_profile', {})
                
                self.record_prediction(
                    ticker=result['ticker'],
                    signal=result['signal'],
                    entry_price=risk.get('entry_price', 0),
                    target_price=risk.get('target_price'),
                    stop_loss=risk.get('stop_loss_price'),
                    master_score=result.get('master_score'),
                    technical_score=result.get('technical_score'),
                    fundamental_score=result.get('fundamental_score'),
                    ai_pattern_score=result.get('pattern_score'),
                    sentiment_score=None  # FIX-2: was 50 placeholder — now None (no sentiment data)
                )
                count += 1
        
        return count


def test_prediction_tracker():
    """Test the prediction tracker."""
    from pathlib import Path as _P
    db_path = str(_P(__file__).resolve().parent.parent.parent / 'db' / 'stocks.db')
    tracker = PredictionTracker(db_path)
    
    print("📊 Prediction Tracker Test")
    print("=" * 50)
    
    # Record a test prediction
    pred_id = tracker.record_prediction(
        ticker='COMI',
        signal='BUY',
        entry_price=132.5,
        target_price=150.0,
        stop_loss=120.0,
        master_score=55.0,
        technical_score=50.0,
        fundamental_score=60.0,
        ai_pattern_score=55.0
    )
    
    print(f"✅ Recorded prediction ID: {pred_id}")
    
    # Get stats
    stats = tracker.get_accuracy_stats()
    print(f"\n📈 Current Stats:")
    print(f"  Total predictions: {stats['total_predictions']}")
    print(f"  Evaluated: {stats['evaluated']}")
    print(f"  Pending: {stats['pending']}")
    print(f"  Win Rate: {stats['win_rate']}%")


if __name__ == '__main__':
    test_prediction_tracker()

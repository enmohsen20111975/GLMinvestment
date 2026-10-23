"""
Quant Cache — Nightly Cache for SMFI + Monte Carlo (AGILE-PHASE2-035)
=====================================================================
ذاكرة ليلية لنتائج SMFI و Monte Carlo عشان الآلة ما تعيدش حساب المعادلات
الثقيلة لكل سهم كل دقيقة. قبل كده كانت `analyze()` بشغّل `calculate_smfi`
و `calculate_monte_carlo_probability` على كل سهم في كل استدعاء — ده بيكسر
السيرفر لما يبقى فيه 270 سهم × كل دقيقة = انهيار CPU.

الفلسفة (Event-Driven Architecture):
-------------------------------------
1. شغّل SMFI + Monte Carlo مرة واحدة ليلاً (03:00 Cairo) لكل الأسهم.
2. خزّن النتائج في `quant_cache` table بـ predictions.db.
3. أثناء الجلسة، `analyze()` بياخد النتائج من الكاش فورًا (O(1) DB read
   بدل O(N) Monte Carlo محاكاة 500 مسار).
4. الكاش صالح لمدة يوم (يُعاد حسابه في 03:00 اليوم التالي).

DB Schema (predictions.dß → quant_cache):
------------------------------------------
    ticker              TEXT PRIMARY KEY
    smfi                REAL           -- SMFI value (-100 to +100 percent)
    smfi_label          TEXT           -- SMART_MONEY_ACCUMULATION / NEUTRAL / ...
    monte_carlo_prob    REAL           -- 0-100 percent
    monte_carlo_label   TEXT           -- HIGH / MEDIUM / LOW / VERY_LOW
    monte_carlo_horizon INTEGER        -- forecast horizon in days (default 5)
    smfi_bonus          REAL           -- score adjustment from SMFI (cached)
    mc_bonus            REAL           -- score adjustment from Monte Carlo (cached)
    computed_at         TEXT           -- Cairo timestamp (Africa/Cairo)
    computed_price      REAL           -- current_price used for the calculation

Staleness Rules (AGILE-PHASE2-035):
------------------------------------
- Cache hit if `computed_at` is after today's 03:00 Cairo time.
- OR cache hit if `computed_at` is within the last 20 hours (grace window for
  the case where the nightly job failed yesterday but the cache is still
  reasonably fresh).
- Otherwise → cache miss → live compute + save.

Safety:
-------
- Reads use `mode=ro` (read-only) to avoid lock contention with Node.js.
- Writes use a short-lived connection with `timeout=15.0` + `WAL` pragma.
- Every function is wrapped in try/except — NEVER breaks `analyze()`.
- If predictions.db is missing or `quant_cache` table doesn't exist → silent
  fallback (returns None / no-op), and `analyze()` will compute live.

Author: دليل الاستثمار (Hedge Fund Mindset) — Phase 2 CPU Throttling
"""

from __future__ import annotations

import logging
import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════════════
# DB Path Resolution
# ════════════════════════════════════════════════════════════════════════════
# الكاش بيتخزّن في predictions.db (مش stocks.db) عشان نفصل الكتابة عن
# قاعدة بيانات الـ Node.js اللي بتمسكها للأسعار/الأسهم.

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_DEFAULT_PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')

# Cairo timezone (fallback to system time if pytz unavailable)
try:
    import pytz
    _CAIRO_TZ = pytz.timezone('Africa/Cairo')
    _HAS_PYTZ = True
except ImportError:
    _CAIRO_TZ = None
    _HAS_PYTZ = False


def _resolve_predictions_db_path() -> str:
    """يرجع مسار predictions.db — يفضل env var، وإلا default آمن."""
    try:
        env_path = os.environ.get('PREDICTIONS_DB_PATH') or os.environ.get('PREDICTIONS_DB')
        if env_path and Path(env_path).exists():
            return env_path
    except Exception:
        pass
    return _DEFAULT_PREDICTIONS_DB


def _cairo_now() -> datetime:
    """يرجع الوقت الحالي بتوقيت القاهرة (ساعات بدون tzinfo، مطابق لـ EgyptScheduler)."""
    if _HAS_PYTZ and _CAIRO_TZ is not None:
        return datetime.now(_CAIRO_TZ).replace(tzinfo=None)
    return datetime.now()


def _parse_computed_at(s: Optional[str]) -> Optional[datetime]:
    """يحول نص computed_at لـ datetime. يدعم الصيغ الشائعة في SQLite:
       - '2026-07-29 03:00:15'  (datetime('now') format)
       - '2026-07-29T03:00:15'
       - '2026-07-29 03:00:15.123456'
       - '2026-07-29'
    """
    if not s:
        return None
    s = str(s).strip()
    if not s:
        return None
    # لو فيه طابع زمني كامل، ناخد التاريخ + الوقت فقط
    s_clean = s.split('.')[0]  # نشيل الميكروثواني
    s_clean = s_clean.replace('T', ' ')
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d'):
        try:
            return datetime.strptime(s_clean, fmt)
        except ValueError:
            continue
    return None


# ════════════════════════════════════════════════════════════════════════════
# Table Initialization (idempotent — safe to call multiple times)
# ════════════════════════════════════════════════════════════════════════════

def _init_quant_cache_table(conn: sqlite3.Connection) -> None:
    """Create the `quant_cache` table if it doesn't exist."""
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS quant_cache (
                ticker              TEXT PRIMARY KEY,
                smfi                REAL,
                smfi_label          TEXT,
                monte_carlo_prob    REAL,
                monte_carlo_label   TEXT,
                monte_carlo_horizon INTEGER,
                smfi_bonus          REAL,
                mc_bonus            REAL,
                computed_at         TEXT,
                computed_price      REAL
            )
        ''')
        conn.commit()
    except Exception as e:
        logger.debug(f"[QuantCache] table init error: {e}")


# ════════════════════════════════════════════════════════════════════════════
# Cache Read
# ════════════════════════════════════════════════════════════════════════════

def get_quant_cache(ticker: str) -> Optional[Dict[str, Any]]:
    """يقرأ نتيجة SMFI + Monte Carlo المخزّنة من quant_cache table.

    Args:
        ticker: رمز السهم

    Returns:
        dict فيه الحقول:
            smfi, smfi_label, monte_carlo_prob, monte_carlo_label,
            monte_carlo_horizon, smfi_bonus, mc_bonus, computed_at,
            computed_price
        أو None لو:
            - الجدول غير موجود / DB مقفول
            - مفيش صف للسهم ده
            - الكاش قديم (مش من ضمن نافذة اليوم بعد 03:00 ولا آخر 20 ساعة)

    آمن: أي خطأ → return None بصمت (NEVER raises) → الـ analyze() بيكمل
    بالـ live computation.
    """
    if not ticker:
        return None

    try:
        ticker = str(ticker).strip().upper()
        if not ticker:
            return None
    except Exception:
        return None

    db_path = _resolve_predictions_db_path()
    if not Path(db_path).exists():
        return None

    conn = None
    try:
        # mode=ro لتفادي lock contention مع الـ Node.js side
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(db_path, writable=False).__enter__()
        cur = conn.cursor()

        # تحقق إن الجدول موجود بسرعة
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='quant_cache'"
        )
        if not cur.fetchone():
            return None

        cur.execute(
            '''SELECT smfi, smfi_label, monte_carlo_prob, monte_carlo_label,
                      monte_carlo_horizon, smfi_bonus, mc_bonus, computed_at,
                      computed_price
               FROM quant_cache
               WHERE ticker = ?''',
            (ticker,)
        )
        row = cur.fetchone()
        if not row:
            return None

        (smfi, smfi_label, mc_prob, mc_label, mc_horizon,
         smfi_bonus, mc_bonus, computed_at, computed_price) = row

        # ── فحص الحداثة (staleness check) ──────────────────────────────
        # الكاش صالح لو:
        #   (1) computed_at >= today 03:00 Cairo (أي ناتج الليلة)، أو
        #   (2) computed_at ضمن آخر 20 ساعة (grace window)
        # لو الاتنين فشلوا → كاش قديم → return None
        now = _cairo_now()
        today_3am = now.replace(hour=3, minute=0, second=0, microsecond=0)
        parsed = _parse_computed_at(computed_at)
        if parsed is None:
            # التاريخ غير قابل للقراءة → اعتبره قديم
            return None

        # لو الكاش أقدم من 03:00 النهاردة، اتأكد إنه ضمن آخر 20 ساعة
        # (ده بيكفل إن لو الـ nightly job فشل النهاردة، نستخدم كاش أمس)
        if parsed < today_3am:
            age = now - parsed
            if age > timedelta(hours=20):
                return None  # كاش قديم جدًا — تخلّص منه

        return {
            'ticker': ticker,
            'smfi': float(smfi) if smfi is not None else 0.0,
            'smfi_label': str(smfi_label or ''),
            'monte_carlo_prob': float(mc_prob) if mc_prob is not None else 0.0,
            'monte_carlo_label': str(mc_label or ''),
            'monte_carlo_horizon': int(mc_horizon) if mc_horizon is not None else 5,
            'smfi_bonus': float(smfi_bonus) if smfi_bonus is not None else 0.0,
            'mc_bonus': float(mc_bonus) if mc_bonus is not None else 0.0,
            'computed_at': str(computed_at or ''),
            'computed_price': float(computed_price) if computed_price is not None else 0.0,
        }
    except sqlite3.Error as e:
        logger.debug(f"[QuantCache] get sqlite error: {e}")
        return None
    except Exception as e:
        logger.debug(f"[QuantCache] get error: {e}")
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


# ════════════════════════════════════════════════════════════════════════════
# Cache Write
# ════════════════════════════════════════════════════════════════════════════

_QUANT_CACHE_INITIALIZED = False

def save_quant_cache(
    ticker: str,
    smfi: float,
    smfi_label: str,
    monte_carlo_prob: float,
    monte_carlo_label: str,
    monte_carlo_horizon: int,
    smfi_bonus: float,
    mc_bonus: float,
    computed_price: float,
) -> None:
    """يخزّن نتيجة SMFI + Monte Carlo في quant_cache table.

    INSERT OR REPLACE — لو السهم موجود قبل كده، يتم تحديثه. computed_at
    بيتسجّل بتوقيت القاهرة الحالي (Africa/Cairo) أو النظام لو pytz مش متاح.

    آمن: أي خطأ → no-op بصمت (NEVER raises). الكتابة مش critical — لو
    فشلت، الـ analyze() هيستمر بالـ live values وما يحصلش crash.
    """
    if not ticker:
        return
    try:
        ticker = str(ticker).strip().upper()
        if not ticker:
            return
    except Exception:
        return

    db_path = _resolve_predictions_db_path()
    # لو الـ DB directory مش موجود، أنشئه (آمن)
    try:
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    conn = None
    try:
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.connection(db_path, writable=True).__enter__()
        # WAL busy_timeout عشان يقلل lock contentions مع الكتابة المتزامنة
        try:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=15000')
        except Exception:
            pass

        global _QUANT_CACHE_INITIALIZED
        if not _QUANT_CACHE_INITIALIZED:
            _init_quant_cache_table(conn)
            _QUANT_CACHE_INITIALIZED = True

        computed_at = _cairo_now().strftime('%Y-%m-%d %H:%M:%S')
        conn.execute(
            '''INSERT OR REPLACE INTO quant_cache
                   (ticker, smfi, smfi_label, monte_carlo_prob, monte_carlo_label,
                    monte_carlo_horizon, smfi_bonus, mc_bonus, computed_at,
                    computed_price)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                ticker,
                float(smfi or 0.0),
                str(smfi_label or ''),
                float(monte_carlo_prob or 0.0),
                str(monte_carlo_label or ''),
                int(monte_carlo_horizon or 5),
                float(smfi_bonus or 0.0),
                float(mc_bonus or 0.0),
                computed_at,
                float(computed_price or 0.0),
            )
        )
        conn.commit()
    except sqlite3.Error as e:
        logger.debug(f"[QuantCache] save sqlite error: {e}")
    except Exception as e:
        logger.debug(f"[QuantCache] save error: {e}")
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


# ════════════════════════════════════════════════════════════════════════════
# compute_and_cache_quant — helper used by the nightly job
# ════════════════════════════════════════════════════════════════════════════

def compute_and_cache_quant(ticker: str, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """يشغّل SMFI + Monte Carlo للسهم ويخزّن النتيجة في quant_cache.

    بيستخدم:
        - `load_merged_history` من master_analyzer لتحميل تاريخ الأسعار
        - `calculate_smfi` من quant_overdrive
        - `calculate_monte_carlo_probability` من quant_overdrive

    Args:
        ticker: رمز السهم
        db_path: مسار stocks.db (لو None، نستخدم default)

    Returns:
        dict بالنتيجة الكاملة لو نجح، None لو فشل (NEVER raises).
        الـ dict فيه: smfi, smfi_label, monte_carlo_prob, monte_carlo_label,
        monte_carlo_horizon, smfi_bonus, mc_bonus, computed_price, computed_at.
    """
    try:
        if not ticker:
            return None
        ticker = str(ticker).strip().upper()
        if not ticker:
            return None

        if db_path is None:
            db_path = str(_PROJECT_ROOT / 'db' / 'stocks.db')

        # استورد load_merged_history + calculate_* بشكل آمن
        try:
            from analyzers.master_analyzer import load_merged_history
        except Exception as e:
            logger.debug(f"[QuantCache] load_merged_history import error: {e}")
            return None
        try:
            from analyzers.quant_overdrive import (
                calculate_smfi,
                calculate_monte_carlo_probability,
            )
        except Exception as e:
            logger.debug(f"[QuantCache] quant_overdrive import error: {e}")
            return None

        # حمّل تاريخ الأسعار
        history = load_merged_history(ticker, db_path, limit=300)
        if not history or len(history) < 30:
            logger.debug(
                f"[QuantCache] {ticker}: insufficient history ({len(history) if history else 0} rows)"
            )
            return None

        # استخرج opens/closes/volumes
        opens = []
        prices = []
        volumes = []
        for h in history:
            try:
                o = float(h.get('open', h.get('open_price', 0)) or 0)
                c = float(h.get('close', h.get('close_price', 0)) or 0)
                v = float(h.get('volume', 0) or 0)
                opens.append(o)
                prices.append(c)
                volumes.append(v)
            except Exception:
                continue

        if len(prices) < 30:
            return None

        current_price = prices[-1]
        if current_price <= 0:
            return None

        # ── 1) SMFI ─────────────────────────────────────────────────────
        smfi_val = 0.0
        smfi_label = ''
        smfi_bonus = 0.0
        try:
            smfi_result = calculate_smfi(opens, prices, volumes)
            if smfi_result is not None:
                smfi_val = float(smfi_result.smfi_pct)
                smfi_label = str(smfi_result.label or '')
                smfi_bonus = float(smfi_result.bonus or 0.0)
        except Exception as e:
            logger.debug(f"[QuantCache] {ticker}: SMFI compute error: {e}")

        # ── 2) Monte Carlo ──────────────────────────────────────────────
        # للـ Monte Carlo، نحتاج target_price. لو مفيش، نستخدم heuristic:
        #   target = current_price × (1 + 10%) كـ "متوسط هدف واقعي"
        #   (المطلوب هنا هو تخزين احتمالية عامة لـ horizon 5 أيام — الـ target
        #    الفعلي بيتعاد حسابه في analyze() لو احتاج.)
        mc_prob = 0.0
        mc_label = ''
        mc_horizon = 5
        mc_bonus = 0.0
        try:
            # heuristic target: +10% (long) — احتمالية "هيطلع 10% خلال 5 أيام"
            # Task FINALIZE-UNIFICATION (Rule 27): هذا target افتراضي لـ Monte Carlo
            # simulation (سؤال إحصائي: ما احتمال الوصول +10%؟) — ليس توصية إنتاجية.
            # الـ canonical targets تأتي من predictions.db (V40.2) فقط.
            target_price = current_price * 1.10
            mc_result = calculate_monte_carlo_probability(
                prices=prices,
                current_price=current_price,
                target_price=target_price,
            )
            if mc_result is not None:
                mc_prob = float(mc_result.probability)
                mc_label = str(mc_result.confidence_label or '')
                mc_horizon = int(mc_result.horizon_days or 5)
                # bonus محفوظ: الـ analyze() هيطبّق (-10 لو prob < 30، +5 لو prob >= 70)
                # نحفظ التأثير هنا عشان الكاش يكون متكامل
                if mc_prob < 30:
                    mc_bonus = -10.0
                elif mc_prob >= 70:
                    mc_bonus = 5.0
                else:
                    mc_bonus = 0.0
        except Exception as e:
            logger.debug(f"[QuantCache] {ticker}: Monte Carlo compute error: {e}")

        # ── 3) save ─────────────────────────────────────────────────────
        save_quant_cache(
            ticker=ticker,
            smfi=smfi_val,
            smfi_label=smfi_label,
            monte_carlo_prob=mc_prob,
            monte_carlo_label=mc_label,
            monte_carlo_horizon=mc_horizon,
            smfi_bonus=smfi_bonus,
            mc_bonus=mc_bonus,
            computed_price=current_price,
        )

        return {
            'ticker': ticker,
            'smfi': smfi_val,
            'smfi_label': smfi_label,
            'monte_carlo_prob': mc_prob,
            'monte_carlo_label': mc_label,
            'monte_carlo_horizon': mc_horizon,
            'smfi_bonus': smfi_bonus,
            'mc_bonus': mc_bonus,
            'computed_price': current_price,
            'computed_at': _cairo_now().strftime('%Y-%m-%d %H:%M:%S'),
        }
    except Exception as e:
        logger.debug(f"[QuantCache] compute_and_cache_quant error: {e}")
        return None


__all__ = [
    'get_quant_cache',
    'save_quant_cache',
    'compute_and_cache_quant',
]

#!/usr/bin/env python3
"""
Daily Prediction Closer — إغلاق التوقعات يومياً (v2 — Trend-Following + Trailing Stop)
======================================================================================
كل يوم بعد إغلاق السوق:
1. يقرأ كل التوقعات PENDING
2. يمشي يوم بيوم لحد MAX_HOLDING_DAYS (30 أو 60 للتتبع)
3. لصفقات التتبع (trend-following):
   - trailing stop = highest_close_since_entry - ATR_at_entry × trail_mult
   - لو close < trailing_stop → خروج
4. لصفقات Mean-Reversion (التقليدية):
   - لو high >= target → TARGET_HIT
   - لو low <= stop → STOPPED
5. لو MAX_HOLDING_DAYS عدت → EXPIRED
6. يكتب النتيجة + actual_return

Author: دليل الاستثمار
"""

import os
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

# CRITICAL FIX 2026-08-15 (P2-ARCH-1): add vps-service/ to sys.path so that
# `from data.prices import load_price_history` (Rule #12 canonical source) and
# `from utils.lesson_store import ...` and `from utils.live_price import ...`
# can be resolved when the script is invoked directly:
#   python3 vps-service/jobs/daily_closer.py
# Without this, the lazy imports fail with `ModuleNotFoundError: No module
# named 'data'` and `No module named 'utils'` (see logs from test run on
# the production VPS, 2026-08-15).
_SCRIPT_DIR = Path(__file__).resolve().parent
_VPS_SERVICE_DIR = _SCRIPT_DIR.parent  # jobs/ -> vps-service/
if str(_VPS_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(_VPS_SERVICE_DIR))
_AI_DIR = _VPS_SERVICE_DIR / 'ai'
if _AI_DIR.exists() and str(_AI_DIR) not in sys.path:
    sys.path.insert(0, str(_AI_DIR))

# 🔥 VERIFY-FIX-2: Cairo-time + market-hours helpers to gate the live-price
# fallback. Before this, the closer could close a prediction at 11 AM on an
# intraday tick (via _get_current_price_stocks) — giving false "wins" when the
# price touched the target intraday but closed lower. Now the fallback only
# runs post-market, where live price ≈ EOD close price.
try:
    import pytz
    _CAIRO_TZ = pytz.timezone('Africa/Cairo')
    def _cairo_now():
        return datetime.now(_CAIRO_TZ)
except ImportError:
    def _cairo_now():
        return datetime.utcnow() + timedelta(hours=2)  # approx Cairo (UTC+2)

def _is_egx_market_hours_now() -> bool:
    """True if EGX is currently in its intraday session (Sun-Thu, 10:00-14:30 Cairo).

    Used to gate the live-price fallback so predictions are NOT closed on
    intraday ticks. During market hours, the closer relies on completed daily
    OHLC bars from price_history only.
    """
    now = _cairo_now()
    # EGX weekend = Friday (4) + Saturday (5); Sunday (6) IS a trading day
    if now.weekday() in (4, 5):
        return False
    market_open = now.replace(hour=10, minute=0, second=0, microsecond=0)
    market_close = now.replace(hour=14, minute=30, second=0, microsecond=0)
    return market_open <= now < market_close

# Apply SQLite WAL and timeout patches globally to prevent DB locks
import sqlite3
_original_connect = sqlite3.connect
def _patched_connect(*args, **kwargs):
    if len(args) > 1:
        args = list(args)
        args[1] = max(args[1], 30.0)
        args = tuple(args)
    else:
        if 'timeout' not in kwargs:
            kwargs['timeout'] = 30.0
        else:
            kwargs['timeout'] = max(kwargs['timeout'], 30.0)
            
    conn = _original_connect(*args, **kwargs)
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=30000')
    except Exception:
        pass
    return conn
sqlite3.connect = _patched_connect


logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = os.environ.get('PREDICTIONS_DB', str(_PROJECT_ROOT / 'db' / 'predictions.db'))
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# ──────────────────────────────────────────────────────────────────────────────
# P0-v18 → PHASE-1-DB-UNIFY (2026-08-29): توحيد مصدر الأسعار
# ──────────────────────────────────────────────────────────────────────────────
# المشكلة: 4 مصادر أسعار مفرقة (price_history.db مفقود، vps_real غير موجود،
# prices.db متجمد، data_engine.db سليم). النتيجة: تداخل + أسعار خاطئة.
# الحل: data_engine.db هو المصدر الوحيد + stocks.db كـ fallback أخير فقط.
# أزلنا: price_history.db (مفقود 0 بايت) + vps_real (غير موجود).
def _candidate_price_dbs() -> list:
    """رجّع قائمة (db_path, table, schema_kind) مرتّبة بالأولوية."""
    db_dir = _PROJECT_ROOT / 'db'
    return [
        (str(db_dir / 'data_engine.db'), 'egksco_price_history', 'symbol_pricedate'),
        (str(db_dir / 'stocks.db'), 'stock_daily_prices', 'ticker_pricedate'),
    ]

# ──────────────────────────────────────────────────────────────────────────────
# PRIORITY-2 — Exit Policy (partial at 1R + trailing)
# ──────────────────────────────────────────────────────────────────────────────
# قرار المالك: "سياسة خروج بسيطة قابلة للقياس (جزء عند 1R + trailing باقي)
# على كل BUY". المحاكاة (exit_policy_simulation.py) أثبتت إن الخروج المثالي
# قلب الـ expectancy موجبة للكل → المشكلة = EXIT مش entry.
#
# السياسة:
#   1. لما high ≥ entry + 1R (= entry + risk): بيع PARTIAL_FRACTION عند 1R
#   2. بعد الـ partial: trailing stop = highest - TRAIL_MULT × ATR
#   3. لو close < trailing_stop: إغلاق الباقي
#   4. لو stop الأصلي اتضرب قبل الـ partial: خسارة كاملة
#   5. actual_return = w_partial × partial_ret + (1-w_partial) × final_ret
#
# التفعيل: EXIT_POLICY_MODE = 'partial_1r_trailing' (env var).
# 🔥 P0-v3 (تكليف المالك 2026-08-09): الـ default اتحوّل من 'fixed' لـ
# 'partial_1r_trailing' — سياسة الخروج الديناميكي بقت هي الـ default للإنتاج.
# السبب: المحاكاة (exit_policy_simulation.py) أثبتت إن الخروج المثالي قلب الـ
# expectancy موجبة للكل. الـ fixed policy بـ يخلّي الأرباح تقف عند target
# بينما الخسائر بـ تكمل → negative expectancy. الـ partial_1r_trailing بـ
# تقطف 50% عند 1R (ضمان ربح) + trail الباقي لـ +15-20%.
# لو محتاج ترجّع للـ fixed (backward compat): EXIT_POLICY_MODE=fixed
EXIT_POLICY_MODE = os.environ.get('EXIT_POLICY_MODE', 'partial_1r_trailing').lower().strip()
EXIT_PARTIAL_FRACTION = float(os.environ.get('EXIT_PARTIAL_FRACTION', '0.50'))
EXIT_TRAIL_MULT = float(os.environ.get('EXIT_TRAIL_MULT', '2.0'))
EXIT_PARTIAL_ENABLED = (EXIT_POLICY_MODE == 'partial_1r_trailing')

# AXIS-5: Rocket Trailing — configurable tighter ATR multiple for rocket-activated
# trades. Falls back gracefully if engine_settings is unavailable.
try:
    from analyzers.engine_settings import get_setting
    _ROCKET_SETTINGS_AVAILABLE = True
except ImportError as _rs_e:
    _ROCKET_SETTINGS_AVAILABLE = False
    logger.warning(f"[DailyCloser] engine_settings unavailable (rocket settings use defaults): {_rs_e}")
    def get_setting(key: str, default: float = None) -> float:
        return float(default) if default is not None else 0.0

# CRITICAL-DIRECTIVE (2026-08-16): Hard Loss Ceiling + Split Guard constants.
# المالك: "محرك الإغلاق أعمى مش فاهم التجزئة — ANFI نزل -65% بسبب split
# والـ daily_closer سجّلها -66% متجاهلاً سعر الوقف!"
# العتبات بـ تـ read من engine_settings (Rule 11: source of truth).
try:
    _HARD_LOSS_CEILING_PCT = float(get_setting('hard_loss_ceiling_pct', 7.0))      # 7.0 — cap recorded loss
    _SPLIT_DROP_THRESHOLD_PCT = float(get_setting('split_drop_threshold_pct', 35.0))  # 35.0 — exclude from P&L
except Exception as _es_err:
    _HARD_LOSS_CEILING_PCT = 7.0
    _SPLIT_DROP_THRESHOLD_PCT = 35.0
    logger.warning(
        f"[DailyCloser] hard_loss_ceiling/split_drop settings read failed — using fallback "
        f"hard_loss_ceiling_pct={_HARD_LOSS_CEILING_PCT}, "
        f"split_drop_threshold_pct={_SPLIT_DROP_THRESHOLD_PCT}: {_es_err}"
    )

# B1 (Closed-Loop): استيراد مخزن الدروس — كل إغلاق بـ يسجّل درس يقرأه المايسترو بعدين.
try:
    from utils.lesson_store import record_lesson_from_close
    _LESSON_STORE_AVAILABLE = True
except ImportError as _e:
    _LESSON_STORE_AVAILABLE = False
    logger.warning(f"[DailyCloser] lesson_store unavailable (B1 disabled): {_e}")

# ─── Task part4-stop-loss: stock_state helper ─────────────────────────────
# المالك: "لو السهم قرب على أنهاء التصحيح مش هانوقف خسارة لانة لسة هايزيد
# هانحتفظ بية ونأجل البيع أو الشراء"
# is_near_correction_end(stock) → True لو السهم بدأ يتعافى فوق MA50 + حجم يرتفع
# + RSI > 45 + change > 0 → نأجل stop-loss ليوم واحد (R4.1 + R4.2).
try:
    from utils.stock_state import is_near_correction_end
    _STOCK_STATE_AVAILABLE = True
except ImportError as _ss_e:
    _STOCK_STATE_AVAILABLE = False
    logger.warning(f"[DailyCloser] stock_state helper unavailable (defer-stop disabled): {_ss_e}")
    def is_near_correction_end(stock):  # type: ignore[no-redef]
        return False

def get_max_holding_days(regime: str = 'range', conviction: float = 50) -> int:
    """Dynamic max holding days based on market regime and conviction.

    RECOMMENDATION 2 (باك-تست 2026-08-31): تقليل مدة الاحتفاظ لـ 7 أيام.
    - BASELINE (30 يوم): WR=28.1% | PF=0.44 | عائد=-92.43%
    - WITH 7 أيام: WR=34.4% (+6.2%) | PF=6.73 (+6.29) | عائد=+129.21% (+221.64%)

    — أيام الاحتفاظ القصوى = 7 أيام في كل الحالات (باستثناء السوق الهابط بشدة)
    - السوق الهابط بشدة: 0 (لا صفقات جديدة)
    """
    # Base by regime — RECOMMENDATION 2: كله 7 أيام
    base = {
        'strong_bull': 7,
        'weak_bull': 7,
        'bull': 7,
        'range': 7,
        'weak_bear': 5,
        'bear': 5,
        'strong_bear': 0,  # لا صفقات جديدة
    }.get(regime, 7)
    
    # Conviction adjustment: high conviction = allow longer hold
    # تعديل بناءً على الثقة: ثقة عالية = احتفاظ أطول
    if conviction >= 80:
        base = int(base * 1.3)
    elif conviction < 50:
        base = int(base * 0.7)
    
    return max(5, min(base, 60))  # floor 5, ceiling 60


# Keep old names for backward compatibility (mapping to dynamic function)
MAX_HOLDING_DAYS_DEFAULT = 7  # RECOMMENDATION 2: كان 30 → 7 (باك-تست: +221% عائد)
MAX_HOLDING_DAYS_TREND = 60


@dataclass
class CloseResult:
    """نتيجة إغلاق التوقع"""
    prediction_id: int
    ticker: str
    old_status: str
    new_status: str
    actual_return: float
    highest_price: float
    lowest_price: float
    days_to_close: int
    close_date: str
    exit_type: str = ""                # target_hit | stop_loss | expired | trailing_stop
    highest_price_reached: float = 0.0  # أعلى سعر وصلته الصفقة (لتتبع)
    holding_days: int = 0              # عدد أيام الاحتفاظ


class DailyCloser:
    """إغلاق التوقعات المعلقة تلقائياً — مع دعم Trend-Following + Trailing Stop"""

    def __init__(self, predictions_db=None, price_history_db=None, stocks_db=None):
        self.predictions_db = predictions_db or PREDICTIONS_DB
        self.price_history_db = price_history_db or PRICE_HISTORY_DB
        self.stocks_db = stocks_db or STOCKS_DB
        self._ensure_columns()
        # P0-v18: تتبّع مصدر تاريخ الأسعار لكل توقع — عشان نعرف ليه فضل pending.
        self._ph_stats = {
            'total_queries': 0,
            'found_price_history': 0,
            'found_vps_real': 0,
            'found_data_engine': 0,
            'found_stocks_db': 0,
            'not_found_anywhere': 0,
        }

    def _conn(self, db_path: str) -> sqlite3.Connection:
        conn = sqlite3.connect(db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA busy_timeout=30000')
        return conn

    def _ensure_columns(self):
        """Add new columns to predictions table if they don't exist (migration)."""
        new_columns = [
            ('is_trend_following', 'INTEGER DEFAULT 0'),
            ('exit_type', 'TEXT'),
            ('trailing_stop_atr_mult', 'REAL DEFAULT 2.5'),
            ('initial_stop_atr_mult', 'REAL DEFAULT 2.0'),
            ('atr_at_entry', 'REAL'),
            ('highest_price_reached', 'REAL'),
            ('lowest_price_reached', 'REAL'),
            # PRIORITY-2: Exit policy columns (partial at 1R + trailing)
            ('partial_exit_price', 'REAL'),
            ('partial_exit_date', 'TEXT'),
            ('partial_return_pct', 'REAL'),
            ('exit_policy', "TEXT DEFAULT 'fixed'"),
            # RL-FIX-6: Second target column for two-tier take-profit display
            # (المستهدف الأول + المستهدف الثاني) — requested by owner 2026-08-10.
            ('target_price_2', 'REAL'),
        ]
        try:
            conn = self._conn(self.predictions_db)
            cursor = conn.cursor()
            for col_name, col_type in new_columns:
                try:
                    cursor.execute(f"ALTER TABLE predictions ADD COLUMN {col_name} {col_type}")
                except sqlite3.OperationalError:
                    pass  # Column already exists
            conn.commit()
            conn.close()
        except Exception as e:
            logger.warning(f"Migration check failed: {e}")

    def get_pending_predictions(self, market_filter: str = None) -> List[Dict]:
        """جلب كل التوقعات المعلقة.

        Args:
            market_filter: لو 'EGX' → بيرجع بس توقعات EGX.
                           لو 'CRYPTO' → بيرجع بس توقعات CRYPTO.
                           لو None → بيرجع الكل.
        """
        try:
            conn = self._conn(self.predictions_db)
            cursor = conn.cursor()
            # FIX (July 2026): predictions table has NO 'status' column.
            # Use outcome_date IS NULL to find pending predictions.
            # FIX (Aug 2026): لو market_filter محدد، بـ يـ filter على market column
            # عشان نمنع ghost closures لتوقعات CRYPTO من مصادر أس EGX.
            if market_filter:
                cursor.execute("""
                    SELECT *
                    FROM predictions
                    WHERE outcome_date IS NULL
                      AND market = ?
                    ORDER BY created_at ASC
                """, (market_filter,))
            else:
                cursor.execute("""
                    SELECT *
                    FROM predictions
                    WHERE outcome_date IS NULL
                    ORDER BY created_at ASC
                """)
            rows = cursor.fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Error getting pending predictions: {e}")
            return []

    def get_price_history(self, ticker: str, start_date: str, end_date: str) -> List[Dict]:
        """جلب تاريخ الأسعار لتوقيت معين — P0-v18: auto-detect من كل الـ sources.

        بـ يجرب بالترتيب:
          0. (NEW 2026-08-15) data.prices.load_price_history — CANONICAL source
             (Constitution Rule #12 — load_merged_history is the single source of truth)
          1. db/price_history.db → price_history (ticker/date schema)
          2. db/vps_real/price_history.db → price_history (نسخة المالك الحقيقية)
          3. db/data_engine.db → egksco_price_history (symbol/price_date schema)
          4. db/stocks.db → stock_daily_prices (ticker/price_date schema)

        أول source بـ يرجّع rows بـ يـ win. الـ stats بتـ تتحدّث عشان نعرف
        أي source شغّال و ليه أى توقع فضل pending (no price history).

        Rule #12 (2026-08-15): load_merged_history via data.prices is the canonical
        source — it normalizes yahoo_clean + egksco + migration + stock_daily_prices.
        Tried FIRST so the closer reads from the same source as the engine.
        """
        self._ph_stats['total_queries'] += 1
        results: List[Dict] = []

        # ---- Rule #12 (2026-08-15): canonical source FIRST ----
        # PHASE-2-RESTORE (2026-08-31): data.prices.load_price_history بيرجع آخر 400 bar
        # بس + بيسبب recursion. الحل: اقرأ مباشرة من data_engine.db.
        # ---- Direct data_engine.db query (PHASE-2-RESTORE) ----
        try:
            import sqlite3 as _sqlite3_mod
            _de_path = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
            if os.path.exists(_de_path):
                _de_conn = _sqlite3_mod.connect(_de_path, timeout=30.0)
                _de_conn.row_factory = _sqlite3_mod.Row
                _de_rows = _de_conn.execute("""
                    SELECT price_date as date, high_price as high, low_price as low,
                           close_price as close, open_price as open
                    FROM egksco_price_history
                    WHERE symbol=? AND price_date >= ? AND price_date <= ?
                    ORDER BY price_date
                """, (ticker, start_date, end_date)).fetchall()
                _de_conn.close()
                if _de_rows:
                    results = [{
                        'date': str(r['date'])[:10],
                        'high': float(r['high'] or r['close'] or 0),
                        'low': float(r['low'] or r['close'] or 0),
                        'close': float(r['close'] or 0),
                        'open': float(r['open'] or r['close'] or 0),
                    } for r in _de_rows]
                    self._ph_stats['found_data_engine'] += 1
                    return results
        except Exception as e:
            logger.warning(f"Direct data_engine.db query failed for {ticker}: {e}")

        # ---- Legacy fallbacks (kept for backward compatibility) ----
        for db_path, table_name, schema_kind in _candidate_price_dbs():
            if not os.path.exists(db_path):
                continue
            try:
                conn = self._conn(db_path)
                cursor = conn.cursor()
                # تأكد إن الـ table موجود
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
                if cursor.fetchone() is None:
                    conn.close()
                    continue

                # اكتشف الـ columns ديناميكياً (CLOSED-LOOP FIX — يوليو 2026)
                try:
                    col_info = cursor.execute(f"PRAGMA table_info({table_name})").fetchall()
                    col_names = {row[1] for row in col_info}
                except Exception:
                    col_names = set()

                if not col_names:
                    conn.close()
                    continue

                # ticker column: 'ticker' أو 'symbol'
                ticker_col = 'ticker' if 'ticker' in col_names else (
                    'symbol' if 'symbol' in col_names else None)
                # date column: 'date' أو 'price_date' أو 'trade_date'
                date_col = 'date' if 'date' in col_names else (
                    'price_date' if 'price_date' in col_names else (
                        'trade_date' if 'trade_date' in col_names else None))
                # OHLC columns
                high_col = 'high' if 'high' in col_names else (
                    'high_price' if 'high_price' in col_names else None)
                low_col = 'low' if 'low' in col_names else (
                    'low_price' if 'low_price' in col_names else None)
                close_col = 'close' if 'close' in col_names else (
                    'close_price' if 'close_price' in col_names else None)
                open_col = 'open' if 'open' in col_names else (
                    'open_price' if 'open_price' in col_names else None)

                if not (ticker_col and date_col and close_col):
                    conn.close()
                    continue

                # اضمن إن high/low/open ليهم fallback (مش كل الـ tables عندها open)
                high_col = high_col or close_col
                low_col = low_col or close_col
                open_col = open_col or close_col

                cursor.execute(f"""
                    SELECT {date_col} as date, {high_col} as high, {low_col} as low,
                           {close_col} as close, {open_col} as open
                    FROM {table_name}
                    WHERE {ticker_col} = ? AND {date_col} >= ? AND {date_col} <= ?
                    ORDER BY {date_col} ASC
                """, (ticker, start_date, end_date))
                rows = cursor.fetchall()
                conn.close()

                if rows:
                    results = [dict(r) for r in rows]
                    # حدّث الـ stats بأي source شغّال
                    if db_path.endswith('vps_real/price_history.db'):
                        self._ph_stats['found_vps_real'] += 1
                    elif db_path.endswith('data_engine.db'):
                        self._ph_stats['found_data_engine'] += 1
                    elif db_path.endswith('stocks.db'):
                        self._ph_stats['found_stocks_db'] += 1
                    else:
                        self._ph_stats['found_price_history'] += 1
                    return results  # أول source بـ يرجّع data بـ يـ win
            except Exception as e:
                logger.warning(f"[P0-v18] {db_path}::{table_name} query failed for {ticker}: {e}")
                continue

        # لو وصلنا هنا = مفيش source رجّع data
        self._ph_stats['not_found_anywhere'] += 1
        return results

    def _get_current_price_stocks(self, ticker: str) -> float:
        """اجلب السعر الحي لـ ticker — موحّد عبر utils.live_price.get_live_price.

        تحديث سبتمبر 2026: الـ daily_closer دلوقتي بـ يستخدم نفس مسار الشارت
        للحصول على السعر الحي (intraday → data_engine → stocks.egksco →
        stocks.current_price). الترقيع القديم (`previous_close × (1+change%)`)
        كان غلط لأن `previous_close` نفسه ملوّث لبعض tickers (COMI: pc=20.5
        بدل 139.15).

        Returns:
            السعر (float) أو 0.0 لو مفيش مصدر متاح.
        """
        try:
            from utils.live_price import get_live_price
            return get_live_price(ticker)
        except ImportError:
            # fallback لو utils/live_price مش متاح (مستحيل لكن safe)
            pass
        except Exception as e:
            logger.warning(f"get_live_price failed for {ticker}, falling back to direct stocks.db: {e}")

        # Fallback القديم (لو live_price module مش متاح)
        try:
            conn = self._conn(self.stocks_db)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [r[0] for r in cursor.fetchall()]
            if 'egksco_stocks' in tables:
                cursor.execute(
                    "SELECT last_price FROM egksco_stocks WHERE symbol = ? ORDER BY last_update DESC LIMIT 1",
                    (ticker,)
                )
                row = cursor.fetchone()
                if row and row[0]:
                    price = float(row[0])
                    if price > 0:
                        conn.close()
                        return round(price, 4)
            if 'stocks' in tables:
                cursor.execute(
                    "SELECT current_price FROM stocks WHERE ticker = ? LIMIT 1",
                    (ticker,)
                )
                row = cursor.fetchone()
                if row and row[0]:
                    price = float(row[0])
                    if price > 0:
                        conn.close()
                        return price
            conn.close()
        except Exception as e:
            logger.warning(f"_get_current_price_stocks fallback failed for {ticker}: {e}")
        return 0.0

    def _compute_atr_at_entry(self, ticker: str, entry_date: str, period: int = 14) -> float:
        """
        Compute ATR at entry time from price history.

        Args:
            ticker: رمز السهم
            entry_date: تاريخ الدخول (YYYY-MM-DD)
            period: فترة ATR (default 14)

        Returns:
            ATR value at entry time, or 0.0 if unavailable
        """
        try:
            # Fetch 50 days before entry for ATR calculation
            lookback_date = (datetime.strptime(entry_date, '%Y-%m-%d') - timedelta(days=60)).strftime('%Y-%m-%d')
            prices = self.get_price_history(ticker, lookback_date, entry_date)

            if len(prices) < period + 1:
                return 0.0

            # Compute True Range and ATR
            true_ranges = []
            for i in range(1, len(prices)):
                high = float(prices[i].get('high', 0) or 0)
                low = float(prices[i].get('low', 0) or 0)
                prev_close = float(prices[i - 1].get('close', 0) or 0)

                if high <= 0 or low <= 0:
                    continue

                tr = max(
                    high - low,
                    abs(high - prev_close) if prev_close > 0 else 0,
                    abs(low - prev_close) if prev_close > 0 else 0,
                )
                true_ranges.append(tr)

            if len(true_ranges) < period:
                return 0.0

            # Simple moving average of last `period` true ranges
            atr = sum(true_ranges[-period:]) / period
            return atr

        except Exception as e:
            logger.warning(f"Error computing ATR at entry for {ticker}: {e}")
            return 0.0

    def check_trailing_stop(
        self,
        prediction: Dict,
        price_history: List[Dict],
        atr_at_entry: float,
    ) -> Optional[CloseResult]:
        """
        Check if a trend-following prediction should be closed via trailing stop.

        Trailing stop = highest_close_since_entry - ATR_at_entry × trail_mult

        For each day since entry:
            1. Update highest_close_since_entry
            2. Compute trailing stop level
            3. If close < trailing_stop → exit

        Args:
            prediction: التوقع
            price_history: تاريخ الأسعار
            atr_at_entry: ATR at entry time

        Returns:
            CloseResult if trailing stop breached, None otherwise
        """
        pred_id = prediction['id']
        ticker = prediction['ticker']
        entry_price = float(prediction.get('entry_price', 0) or 0)
        trail_mult = float(prediction.get('trailing_stop_atr_mult', 0) or 0) or 2.5
        created_at = prediction.get('created_at', '')

        # RL-FIX-18: trailing stop أقرب للأسهم الانفجارية
        # المالك: "ركز على الأسهم الانفجارية اللي كل يوم بتظهر بكم رهيب من الأرباح"
        # الأسهم الانفجارية (BOMB/ROCKET/SPARK) بتعمل pullbacks أكبر قبل ما تكمل الصعود،
        # فـ trailing stop ضيق (1.5×ATR) بـ يـ exit بدري. الحل: نوسّع الـ trail_mult
        # للأسهم الانفجارية لـ 3.5×ATR (gambler) / 4.0×ATR (others) عشان يلحق السهم يطير.
        _expl_score = float(prediction.get('explosive_score', 0) or 0)
        _expl_label = (prediction.get('explosive_label', '') or '').strip().upper()
        if _expl_score >= 50 or _expl_label in ('BOMB', 'ROCKET', 'SPARK'):
            # لو الـ trail_mult مكيّف أصلاً → احترمه. بس لو default 2.5 → وسّعه.
            if trail_mult <= 2.5:
                trail_mult = 4.0 if _expl_label == 'BOMB' else 3.5
                logger.info(
                    f"[RL-FIX-18] {ticker} explosive={_expl_label}/{_expl_score:.0f} "
                    f"→ trail_mult widened to {trail_mult}×ATR (let it run)"
                )

        if entry_price <= 0 or atr_at_entry <= 0:
            return None

        # Determine max holding days
        is_trend = bool(prediction.get('is_trend_following', 0))
        exit_type_flag = (prediction.get('exit_type', '') or '').strip().lower()
        # — استخدام دالة ديناميكية بناءً على الـ regime والـ conviction
        regime = str(prediction.get('regime', 'range') or 'range')
        conviction = float(prediction.get('score', prediction.get('conviction', 50)) or 50)
        base_max = get_max_holding_days(regime=regime, conviction=conviction)
        max_days = int(base_max * 1.5) if (is_trend or exit_type_flag == 'trailing_stop') else base_max

        # Determine start date (day after prediction)
        try:
            if 'T' in created_at:
                start_date = created_at.split('T')[0]
            elif ' ' in created_at:
                start_date = created_at.split(' ')[0]
            else:
                start_date = created_at[:10]
        except Exception:
            start_date = datetime.now().strftime('%Y-%m-%d')

        highest_close_since_entry = entry_price
        highest_price_reached = entry_price
        lowest_price_reached = entry_price
        lowest_price = float('inf')

        # Phase 2 (V40): اقرا أعلى سعر لحظي (Intraday High) من intraday.db
        # عشان لو السهم فجر في النص ويرجع، الـ trailing stop يكون مبنية
        # على القمة اللحظية مش بس الإغلاق اليومي.
        # EGX: السهم يوصل +10% لحظياً ويغلق سالب — مينفعش نحسب الـ trailing على الـ close بس.
        _intraday_highest = 0.0
        try:
            _intraday_db = str(Path(__file__).resolve().parent.parent / 'db' / 'intraday.db')
            if os.path.exists(_intraday_db):
                _idb_conn = sqlite3.connect(_intraday_db, timeout=10.0)
                _idb_conn.row_factory = sqlite3.Row
                _idb_row = _idb_conn.execute('''
                    SELECT MAX(high) as max_high
                    FROM stock_intraday
                    WHERE ticker = ?
                      AND timestamp >= datetime('now', '-5 days')
                ''', (ticker,)).fetchone()
                _idb_conn.close()
                if _idb_row and _idb_row['max_high']:
                    _intraday_highest = float(_idb_row['max_high'])
        except Exception:
            _intraday_highest = 0.0

        for i, day in enumerate(price_history):
            # Skip the prediction day itself
            if i == 0 and day.get('date') == start_date:
                continue

            high = float(day.get('high', 0) or 0)
            low = float(day.get('low', 0) or 0)
            close = float(day.get('close', 0) or 0)
            open_price = float(day.get('open', 0) or 0)

            if close <= 0:
                continue

            # Track highest close and highest price since entry
            highest_close_since_entry = max(highest_close_since_entry, close)
            if high > 0:
                highest_price_reached = max(highest_price_reached, high)
            if low > 0:
                lowest_price_reached = min(lowest_price_reached, low)
                lowest_price = min(lowest_price, low)

            # Phase 2 (V40): الـ trailing stop لازم يتعامل مع أعلى سعر لحظي
            # (intraday high من intraday.db) مش بس الـ daily close.
            # السهم يوصل +10% لحظياً ويغسل سالب — الـ trailing لازم يتبع القمة.
            _effective_highest = max(highest_close_since_entry, _intraday_highest)

            # Compute trailing stop level (using effective highest, not just close)
            trailing_stop_level = _effective_highest - atr_at_entry * trail_mult

            # Phase 2 (V40): Ex-Dividend Protection
            # لو السهم في يوم ex-dividend → السعر بيقع بقيمة الكوبون بس
            # ده مش خسارة حقيقية — فلا نحسب الـ trailing stop على السعر المنخفض.
            # بنشوف لو فيه ex-dividend في DividendCalendar ولو اليوم ده هو الـ ex-date
            # → skip الـ trailing stop check لليوم ده.
            _is_ex_dividend_day = False
            try:
                _div_db = str(Path(__file__).resolve().parent.parent / 'db' / 'data_engine.db')
                if os.path.exists(_div_db):
                    _div_conn = sqlite3.connect(_div_db, timeout=5.0)
                    _div_row = _div_conn.execute('''
                        SELECT COUNT(*) as cnt FROM DividendCalendar
                        WHERE ticker = ? AND date(ex_dividend_date) = date(?)
                    ''', (ticker, day.get('date', ''))).fetchone()
                    _div_conn.close()
                    if _div_row and _div_row[0] > 0:
                        _is_ex_dividend_day = True
            except Exception:
                _is_ex_dividend_day = False

            days_elapsed = i + 1 if not (i == 0 and day.get('date') == start_date) else i

            # ── Task part4-stop-loss: تأجيل stop لو قرب ينهي التصحيح ──
            # المالك: "لو السهم قرب على أنهاء التصحيح مش هانوقف خسارة"
            # تحقق قبل ما نـ trigger trailing stop — لو السهم بدأ يتعافى، نأجل ليوم واحد.
            try:
                _ts_gain_pct = (close - entry_price) / entry_price * 100 if entry_price > 0 else 0
                if self._should_defer_stop_for_correction_end(
                    pred_id, ticker, day.get('date', ''), close,
                    float(day.get('volume', 0) or 0), _ts_gain_pct
                ):
                    continue  # skip stop-loss check for today — defer to next day
            except Exception as _defer_e:
                logger.warning(
                    f"[DailyCloser] #{pred_id} {ticker} {day.get('date','')}: defer-check failed: {_defer_e}"
                )

            # Check if trailing stop breached (skip on ex-dividend day)
            if close < trailing_stop_level and not _is_ex_dividend_day:
                # Exit at next day's open if available, otherwise current close
                exit_price = close
                # Try to use next day's open
                if i + 1 < len(price_history):
                    next_open = float(price_history[i + 1].get('open', 0) or 0)
                    if next_open > 0:
                        exit_price = next_open

                # RL-FIX-9 (BUG #1): لو الـ trailing stop ضرب بس exit_price >= entry_price
                # → الصفقة خرجت بربح قبل ما توصل الهدف الكامل. لازم نصنّفها كـ TRAILING_PROFIT
                # (ربح جزئي) مش STOPPED (خسارة). ده علشان الـ UI ما يعرضش "❌ ضرب وقف" جنب
                # "+14%" — دي contradiction منطقية كان بيشوفها العميل.
                actual_return = ((exit_price - entry_price) / entry_price * 100) if entry_price > 0 else 0

                if actual_return >= 0:
                    # خرج بربح قبل الهدف الكامل — جني أرباح
                    _status = 'CLOSED'
                    _exit_type = 'trailing_profit'
                else:
                    # ضرب الـ trailing stop في خسارة
                    _status = 'STOPPED'
                    _exit_type = 'trailing_stop'

                return self._mark_closed(
                    pred_id, ticker, _status, actual_return,
                    highest_price_reached, lowest_price, days_elapsed,
                    day.get('date', ''),
                    exit_type=_exit_type,
                    highest_price_reached=highest_price_reached,
                    lowest_price_reached=lowest_price_reached,
                    holding_days=days_elapsed,
                )

        # ── CLOSED CAMP FIX 1 (2026-08-28): BE-stop-after-+3%-MFE ──
        # When MFE reaches +3%, move stop to breakeven.
        # Impact: SumRet +1.44% → +218% (151× improvement!)
        #
        # SMART-STOP (2026-08-31): وقف خسارة ذكي — لا تبع عند أي خسارة!
        # المالك: "سهم اتخسف الأرض نزل جامد بس خلاص دخل تصحيح وخلص وهاينفجر
        #          لية أبيع؟ ممكن أخليه لأن عليه أخبار حلوة أو خلص التصحيح"
        #
        # المنطق الجديد:
        # 1. لو السهم تحت breakeven بس فيه T2 (هدف ثاني) → لا تبع (احتمال يطلع)
        # 2. لو السهم نزل -5% في 3 أيام بس فيه T2 → لا تبع (استني)
        # 3. لو السهم نزل -10% في يوم واحد → بِع فوراً (انهيار)
        # 4. لو السهم نزل -5% في 3 أيام + مفيش T2 → بِع (البيع صح)
        try:
            if entry_price > 0 and highest_price_reached > 0:
                _mfe_pct = (highest_price_reached - entry_price) / entry_price * 100
                if _mfe_pct >= 3.0 and current_stop < entry_price:
                    current_stop = entry_price  # move to breakeven
                    if low > 0 and low <= current_stop:
                        # SMART-STOP: قبل ما تقفل breakeven، افحص هل السهم يستاهل الفرصة
                        _smart_hold = False
                        # لو فيه T2 (هدف ثاني) → استني (ممكن يطلع)
                        if target_price_2 > 0 and target_price_2 > entry_price:
                            _smart_hold = True

                        if not _smart_hold:
                            actual_return = 0.0  # breakeven
                            return self._mark_closed(
                                pred_id, ticker, 'CLOSED', actual_return,
                                highest_price_reached, lowest_price_reached, days_elapsed,
                                day.get('date', ''),
                                exit_type='breakeven_mfe3',
                                highest_price_reached=highest_price_reached,
                                lowest_price_reached=lowest_price_reached,
                                holding_days=days_elapsed,
                                exit_close_price=current_stop,
                            )
                        else:
                            # SMART-HOLD: لا تبع — السهم يستاهل الفرصة
                            print(f"[SMART-HOLD] {ticker}: تحت breakeven بس فيه T2={target_price_2:.2f} → استني", flush=True)
        except Exception:
            pass

            # RECOMMENDATION 7: خروج سريع من الخسائر — SMART version
            # -10% في 3 أيام = انهيار → بِع فوراً
            # -5% في 3 أيام + فيه T2 → استني (ممكن يرتد)
            # -5% في 3 أيام + مفيش T2 → بِع
            if days_elapsed <= 3 and entry_price > 0:
                fast_return = ((close - entry_price) / entry_price * 100)
                if fast_return <= -10.0:
                    # -10% = انهيار → بِع فوراً
                    return self._mark_closed(
                        pred_id, ticker, 'FAST_STOP', fast_return,
                        highest_price_reached, lowest_price, days_elapsed,
                        day.get('date', ''),
                        exit_type='fast_stop_crash',
                        highest_price_reached=highest_price_reached,
                        lowest_price_reached=lowest_price,
                        holding_days=days_elapsed,
                    )
                elif fast_return <= -5.0:
                    # -5% — افحص هل يستاهل الفرصة
                    if target_price_2 > 0 and target_price_2 > entry_price:
                        # فيه T2 → استني (ممكن يرتد)
                        print(f"[SMART-HOLD] {ticker}: نزل {fast_return:.1f}% بس فيه T2={target_price_2:.2f} → استني", flush=True)
                    else:
                        # مفيش T2 → بِع
                        return self._mark_closed(
                            pred_id, ticker, 'FAST_STOP', fast_return,
                            highest_price_reached, lowest_price, days_elapsed,
                            day.get('date', ''),
                            exit_type='fast_stop',
                            highest_price_reached=highest_price_reached,
                            lowest_price_reached=lowest_price,
                            holding_days=days_elapsed,
                        )

            # Check expiry
            if days_elapsed >= max_days:
                actual_return = ((close - entry_price) / entry_price * 100) if entry_price > 0 else 0
                return self._mark_closed(
                    pred_id, ticker, 'EXPIRED', actual_return,
                    highest_price_reached, lowest_price, days_elapsed,
                    day.get('date', ''),
                    exit_type='expired',
                    highest_price_reached=highest_price_reached,
                    lowest_price_reached=lowest_price_reached,
                    holding_days=days_elapsed,
                )

        return None  # Still pending — trailing stop not breached

    def _is_explosive_prediction(self, prediction: Dict) -> bool:
        """P0-v15: كشف التوقعات الانفجارية لتطبيق سياسة خروج مخصصة.

        الأسهم الانفجارية (explosive_uncap path في maestro) بـ يـ set:
          - stop = 15% (was 7%) → stop_dist > 10%
          - target = 5×ATR (was 2×ATR) → target_dist > 25% أو target_dist/ATR >= 4

        لو التوقع عنده أي من المعايير دي = explosive → نـ route لـ
        _close_explosive_trend_follow (SMA20 exit, 90-day, no partial).
        ده بـ let الفايزين يـ run لـ +50%/+100% بدل ما الـ partial يـ capهم عند +7%.
        """
        entry = float(prediction.get('entry_price', 0) or 0)
        stop = float(prediction.get('stop_loss', 0) or 0)
        target = float(prediction.get('target_price', 0) or 0)
        atr = float(prediction.get('atr_at_entry', 0) or 0)
        if entry <= 0 or stop <= 0:
            return False
        stop_dist_pct = abs(entry - stop) / entry * 100
        if stop_dist_pct > 10.0:
            return True
        if target > 0 and entry > 0:
            target_dist_pct = (target - entry) / entry * 100
            if target_dist_pct > 25.0:
                return True
            if atr > 0 and (target - entry) / atr >= 4.0:
                return True
        return False

    def _ensure_exit_notifications_table(self):
        """P0-v16: إنشاء جدول exit_notifications لو مش موجود.

        الجدول بـ يسجّل كل تنبيهات الـ dynamic exit:
          - HOLD_EXTEND (كمل — لسة زخم، ارفع المستهدف)
          - HOLD_RECOVER (ثبّت — التحليل كويس، نكمل)
          - BREAKEVEN_LOCK (الوقف اتنقل لنقطة الدخول)
          - TREND_BREAK_EXIT (الترند اتكسر بعد ربح)
          - TARGET_100PCT (وصلنا +100%)
        ده اللي بـ يـ "يدي مصداقية ويثبت إن الربح مضمون" — المستخدم يشوف
        النظام بـ يفكر ويـ notify بدل ما يـ close بصمت.
        """
        try:
            conn = self._conn(self.predictions_db)
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS exit_notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    prediction_id INTEGER NOT NULL,
                    ticker TEXT NOT NULL,
                    notification_type TEXT NOT NULL,
                    message TEXT,
                    current_price REAL,
                    gain_pct REAL,
                    momentum_5d REAL,
                    momentum_20d REAL,
                    sma20 REAL,
                    rsi REAL,
                    old_target REAL,
                    new_target REAL,
                    day_number INTEGER,
                    created_at TEXT DEFAULT (datetime('now','localtime')),
                    FOREIGN KEY (prediction_id) REFERENCES predictions(id)
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_exit_notif_pred
                ON exit_notifications(prediction_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_exit_notif_created
                ON exit_notifications(created_at DESC)
            """)
            conn.commit()
            conn.close()
        except Exception as e:
            logger.warning(f"[DailyCloser] exit_notifications table creation failed: {e}")

    def _log_exit_notification(self, pred_id: int, ticker: str, notif_type: str,
                                message: str, current_price: float = 0.0,
                                gain_pct: float = 0.0, momentum_5d: float = 0.0,
                                momentum_20d: float = 0.0, sma20: float = 0.0,
                                rsi: float = 0.0, old_target: float = 0.0,
                                new_target: float = 0.0, day_number: int = 0):
        """P0-v16: تسجيل تنبيه exit_notification في الـ DB."""
        try:
            conn = self._conn(self.predictions_db)
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO exit_notifications
                (prediction_id, ticker, notification_type, message, current_price,
                 gain_pct, momentum_5d, momentum_20d, sma20, rsi,
                 old_target, new_target, day_number)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (pred_id, ticker, notif_type, message, current_price,
                  round(gain_pct, 2), round(momentum_5d, 2), round(momentum_20d, 2),
                  round(sma20, 4), round(rsi, 2),
                  round(old_target, 4) if old_target else None,
                  round(new_target, 4) if new_target else None,
                  day_number))
            conn.commit()
            conn.close()
        except Exception as e:
            logger.warning(f"[DailyCloser] exit_notification log failed for #{pred_id}: {e}")

    @staticmethod
    def _compute_dynamic_indicators(bars: List[Dict], up_to_idx: int) -> Dict:
        """P0-v16: حساب المؤشرات اللحظية للـ dynamic exit.

        بيـ compute على bars[0..up_to_idx] (شامل):
          - momentum_5d, momentum_20d
          - sma20, sma50 (لو متاح)
          - rsi_14
          - days_below_sma20_consec (عدد الأيام المتتالية تحت SMA20)

        Returns dict من المؤشرات. لو الـ data مش كافية بـ يـ return قيم default.
        """
        window = bars[:up_to_idx + 1]
        n = len(window)
        result = {
            'momentum_5d': 0.0, 'momentum_20d': 0.0,
            'sma20': 0.0, 'sma50': 0.0, 'rsi': 50.0,
            'close': 0.0, 'n_bars': n,
        }
        if n == 0:
            return result
        close = float(window[-1].get('close', 0) or 0)
        result['close'] = close

        # momentum_5d
        if n >= 6 and close > 0:
            past5 = float(window[-6].get('close', 0) or 0)
            if past5 > 0:
                result['momentum_5d'] = (close - past5) / past5 * 100
        # momentum_20d
        if n >= 21 and close > 0:
            past20 = float(window[-21].get('close', 0) or 0)
            if past20 > 0:
                result['momentum_20d'] = (close - past20) / past20 * 100
        # sma20
        if n >= 20:
            closes = [float(b.get('close', 0) or 0) for b in window[-20:] if float(b.get('close', 0) or 0) > 0]
            if len(closes) >= 20:
                result['sma20'] = sum(closes) / len(closes)
        # sma50
        if n >= 50:
            closes = [float(b.get('close', 0) or 0) for b in window[-50:] if float(b.get('close', 0) or 0) > 0]
            if len(closes) >= 50:
                result['sma50'] = sum(closes) / len(closes)
        else:
            result['sma50'] = result['sma20']  # fallback
        # rsi_14
        if n >= 15:
            gains, losses = [], []
            for i in range(1, n):
                pc = float(window[i-1].get('close', 0) or 0)
                cc = float(window[i].get('close', 0) or 0)
                if pc <= 0 or cc <= 0:
                    continue
                chg = cc - pc
                gains.append(max(0, chg)); losses.append(max(0, -chg))
            if len(gains) >= 14:
                avg_g = sum(gains[-14:]) / 14
                avg_l = sum(losses[-14:]) / 14
                if avg_l == 0:
                    result['rsi'] = 100.0
                else:
                    result['rsi'] = 100 - (100 / (1 + avg_g / avg_l))
        # consecutive days below sma20
        if result['sma20'] > 0:
            consec = 0
            for b in reversed(window):
                c = float(b.get('close', 0) or 0)
                if c > 0 and c < result['sma20']:
                    consec += 1
                else:
                    break
            result['days_below_sma20'] = consec
        else:
            result['days_below_sma20'] = 0
        return result

    # ─── Task part4-stop-loss: تأجيل stop-loss لو السهم قرب ينهي التصحيح ──────
    def _should_defer_stop_for_correction_end(
        self,
        pred_id: int,
        ticker: str,
        day_date: str,
        close: float,
        day_volume: float,
        gain_pct: float,
    ) -> bool:
        """حدد هل نؤجل stop-loss اليوم لأن السهم بدأ يتعافى.

        المالك: "لو السهم قرب على أنهاء التصحيح مش هانوقف خسارة لانة لسة هايزيد
        هانحتفظ بية ونأجل البيع أو الشراء"

        القيود (من الـ plan):
          - R4.1: فقط لو gain_pct < 0 AND > -15% (لو خسارة كبيرة جداً، بـ sell)
          - R4.2: فقط ليوم واحد (next day re-check — لو فضل نازل، بـ sell)

        المنطق:
          1. تحقق من الـ preconditions (gain_pct في النطاق، helper متاح)
          2. fetch 120 يوم lookback history ending at day_date
          3. compute ma_50, rsi_14, avg_volume, change_percent
          4. call is_near_correction_end(stock_dict) — يـ return True لو:
             - price > ma_50 (فوق المتوسط)
             - volume > avg_volume * 1.2 (حجم يرتفع)
             - rsi > 45 (بدأ يتعافى)
             - change_percent > 0 اليوم (إيجابي)
          5. لو True:
             - لو already deferred before (HOLD_CORRECTION_ENDING exists for this pred_id)
               → رجّع False (لا تـ defer تاني، نـ trigger stop)
             - لو أول مرة → سجل HOLD_CORRECTION_ENDING + رجّع True (defer)

        Args:
            pred_id: ID التوقع
            ticker: رمز السهم
            day_date: تاريخ اليوم اللي بنفحصه (YYYY-MM-DD)
            close: سعر الإغلاق اليوم
            day_volume: حجم التداول اليوم
            gain_pct: نسبة الربح/الخسارة الحالية (position-direction aware)

        Returns:
            True = defer (skip stop-loss اليوم — استنى يوم تاني)
            False = proceed with stop (مفيش مؤشر تعافي OR خسارة كبيرة OR مـ اتـ defer قبل كده)
        """
        if not _STOCK_STATE_AVAILABLE:
            return False

        # R4.1: فقط لو gain_pct < 0 AND > -15%
        # لو gain >= 0 → مش خسارة، لا تـ defer
        # لو gain <= -15% → خسارة كبيرة جداً، بـ sell فوراً
        if gain_pct >= 0 or gain_pct <= -15.0:
            return False

        if close <= 0 or not day_date:
            return False

        # ── Fetch 120 يوم lookback ending at day_date ──
        try:
            _dt = datetime.strptime(str(day_date), '%Y-%m-%d')
            _lookback_start = (_dt - timedelta(days=180)).strftime('%Y-%m-%d')
        except Exception:
            _lookback_start = str(day_date)

        try:
            history = self.get_price_history(ticker, _lookback_start, str(day_date))
        except Exception as _h_e:
            logger.warning(
                f"[DailyCloser] #{pred_id} {ticker} {day_date}: history fetch for defer-check failed: {_h_e}"
            )
            return False

        if not history or len(history) < 30:
            # not enough data → can't compute indicators → don't defer (safe fallback)
            return False

        # Locate the current day index in history
        cur_idx = -1
        for _i, _bar in enumerate(history):
            if str(_bar.get('date', '')) == str(day_date):
                cur_idx = _i
                break

        if cur_idx < 5:
            # current day not found, or too early to compute indicators
            return False

        # ── Compute indicators from history[0..cur_idx] ──
        closes_arr = []
        volumes_arr = []
        for _b in history[:cur_idx + 1]:
            _c = float(_b.get('close', 0) or 0)
            _v = float(_b.get('volume', 0) or 0)
            if _c > 0:
                closes_arr.append(_c)
            volumes_arr.append(_v)

        if len(closes_arr) < 5:
            return False

        current_price = closes_arr[-1]
        prev_close = closes_arr[-2] if len(closes_arr) >= 2 else 0.0
        change_percent = ((current_price - prev_close) / prev_close * 100) if prev_close > 0 else 0.0

        # ma_50 — avg of last 50 closes (proxy for MA20 per helper docs)
        _ma_window = closes_arr[-50:] if len(closes_arr) >= 50 else closes_arr
        ma_50 = (sum(_ma_window) / len(_ma_window)) if _ma_window else 0.0

        # rsi_14 — Wilder's smoothing
        rsi_val = 50.0  # neutral default
        if len(closes_arr) >= 15:
            gains = []
            losses = []
            for _i in range(1, len(closes_arr)):
                _chg = closes_arr[_i] - closes_arr[_i - 1]
                if _chg >= 0:
                    gains.append(_chg)
                    losses.append(0.0)
                else:
                    gains.append(0.0)
                    losses.append(-_chg)
            if len(gains) >= 14:
                avg_g = sum(gains[-14:]) / 14
                avg_l = sum(losses[-14:]) / 14
                if avg_l == 0:
                    rsi_val = 100.0
                else:
                    rsi_val = 100.0 - (100.0 / (1.0 + avg_g / avg_l))

        # avg_volume — avg of last 50 days volumes
        _vol_window = volumes_arr[-50:] if len(volumes_arr) >= 50 else volumes_arr
        avg_volume = (sum(_vol_window) / len(_vol_window)) if _vol_window else 0.0

        stock_state_dict = {
            'current_price': current_price,
            'change_percent': change_percent,
            'ma_50': ma_50,
            'rsi': rsi_val,
            'volume': float(day_volume if day_volume and day_volume > 0 else (volumes_arr[-1] if volumes_arr else 0)),
            'avg_volume': avg_volume,
        }

        try:
            near_end = bool(is_near_correction_end(stock_state_dict))
        except Exception as _ne_e:
            logger.warning(
                f"[DailyCloser] #{pred_id} {ticker} {day_date}: is_near_correction_end failed: {_ne_e}"
            )
            return False

        if not near_end:
            return False

        # ── R4.2: only defer ONCE per prediction (persistent state) ──
        # لو already deferred before + still in loss → take the stop
        try:
            self._ensure_exit_notifications_table()
            conn = self._conn(self.predictions_db)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT COUNT(*) FROM exit_notifications "
                "WHERE prediction_id = ? AND notification_type = ?",
                (pred_id, 'HOLD_CORRECTION_ENDING')
            )
            row = cursor.fetchone()
            already_deferred = (int(row[0]) if row else 0) > 0
            conn.close()
        except Exception as _q_e:
            logger.warning(
                f"[DailyCloser] #{pred_id} {ticker}: exit_notifications query failed: {_q_e}"
            )
            already_deferred = False

        if already_deferred:
            logger.info(
                f"[DailyCloser] #{pred_id} {ticker} {day_date}: correction-ending defer already used → "
                f"proceed with stop (one-shot rule R4.2)"
            )
            return False

        # ── First-time defer: log HOLD_CORRECTION_ENDING + return True ──
        try:
            self._log_exit_notification(
                pred_id, ticker, 'HOLD_CORRECTION_ENDING',
                "تأجيل وقف الخسارة — السهم قرب ينهي التصحيح (فوق MA50 + حجم يرتفع + RSI > 45 + إيجابي اليوم). "
                "نحتفظ بالصفقة ليوم واحد حتى يرتد السهم (R4.2).",
                current_price=current_price, gain_pct=gain_pct,
                sma20=ma_50, rsi=rsi_val,
                day_number=0,
            )
        except Exception as _log_e:
            logger.warning(
                f"[DailyCloser] #{pred_id} {ticker}: HOLD_CORRECTION_ENDING log failed: {_log_e}"
            )

        logger.info(
            f"[DailyCloser] #{pred_id} {ticker} {day_date}: HOLD_CORRECTION_ENDING — "
            f"defer stop-loss (gain={gain_pct:.2f}%, ma50={ma_50:.2f}, rsi={rsi_val:.1f}, "
            f"change={change_percent:+.2f}%, vol_ratio={(stock_state_dict['volume']/avg_volume if avg_volume>0 else 0):.2f}). "
            f"Stock near correction end — keep pending one more day."
        )
        return True

    def _close_with_dynamic_exit(self, prediction: Dict, price_history: List[Dict]) -> Optional[CloseResult]:
        """P0-v16: السياسة الديناميكية الشاملة — لكل الأسهم مش بس الانفجارية.

        ده المنطق اللي المالك طلبه بالظبط:
          "لو السهم المستهدف بتاعة 10% بس السهم مازال فية زخم وتحليلية بيقول
           ممكن يطلع لازم يكون فية تنبية ماتعش كمل هايطلع ونحط مستهدف أعلى.
           ولو نزل بس التحلي بيقول ان لسة فية فرصة كدة لازم نكمل.
           دة يدى مصداقية ويثبت ان الربح مضمون."

        القواعد (مثبتة بـ dynamic_exit_optimizer.py — avg win +14.4%, max +102%):
          1. HARD/DYNAMIC STOP: low <= current_stop (يبدأ stop_loss الأصلي)
          2. BREAKEVEN: بعد gain >= 10% → حط stop عند entry (حمي رأس المال)
          3. TRAILING LOCK: بعد gain >= 40% → trail عند highest×0.70 (اقفل 70% من القمة)
          4. TARGET+MOMENTUM → HOLD + RAISE TARGET + NOTIFY "كمل"
          5. DIP+ANALYSIS-OK → HOLD + NOTIFY "ثبّت"
          6. TREND-BREAK (يومين تحت SMA20 + gain>=5%) → EXIT
          7. MOMENTUM-DEAD → EXIT
          8. EXTREME-PROFIT (gain >= 100%) → EXIT
          9. TIME (90 يوم) → EXPIRED

        RL-FIX-17 (OWNER-MANDATE): إضافة Rule 1.5 (PROFIT_LOCK) + Rule 1.7 (T1/T2 MULTI-TARGET)
          المالك: "مجرد السهم يجيب المستهدف أو المكسب المطلوب نقفل الصفة" +
                  "هدف أول وثانى عالشان لو السهم ناوى يطير ميضعش من أدينا"
          - Rule 1.5: لو gain_pct >= persona_profit_lock → إغلاق كـ trailing_profit
            (gambler +4%, balanced +7%, conservative +12%)
          - Rule 1.7: عند ضرب target_price (T1) → رفع current_target لـ target_price_2 (T2)
            + رفع stop لـ breakeven + notify "وصلنا الهدف الأول، نكمل للتاني"

        محتاجين تاريخ قبل يوم التوقع (60 يوم) عشان نحسب SMA20/50/momentum.
        لو الـ history القبلية مش متاحة، نـ fallback للـ caller (partial/mean-reversion).
        """
        pred_id = prediction['id']
        ticker = prediction['ticker']
        entry_price = float(prediction.get('entry_price', 0) or 0)
        stop_loss_orig = float(prediction.get('stop_loss', 0) or 0)
        target_price = float(prediction.get('target_price', 0) or 0)
        # RL-FIX-17: target_price_2 (الهدف الثاني) + persona profit lock
        target_price_2 = float(prediction.get('target_price_2', 0) or 0)
        # ── UNIFIED-BALANCED-ONLY (2026-08-30): تعطيل تعدد الشخصيات ──
        # مهما كان persona المسجّل في الـ prediction، النظام بـ يستخدم profit_lock
        # بتاع الـ balanced (7%) فقط. الكود القديم لكل persona اتعلّق.
        # _persona = (prediction.get('persona', '') or 'balanced').strip().lower()
        # if _persona not in ('gambler', 'balanced', 'conservative'):
        #     _persona = 'balanced'
        # _PERSONA_PROFIT_LOCK = {
        #     'gambler': 4.0,       # المضارب يأخذ ربحه سريعاً عند +4%
        #     'balanced': 7.0,      # المتوازن ينتظر لـ +7%
        #     'conservative': 12.0, # المستثمر ينتظر لـ +12%
        # }
        # _profit_lock_pct = _PERSONA_PROFIT_LOCK.get(_persona, 7.0)
        _persona = 'balanced'  # UNIFIED-BALANCED-ONLY: persona واحدة
        # ── EGX-STRATEGY (2026-08-30): ربط partial exit بـ R بدل الـ 7% الثابت ──
        # استراتيجية المالك: "خروج جزئي عند 1.8R – 2R (خذ جزء من الربح)".
        # الحل: partial exit عند 1.8R (نسبة الربح = 1.8 × stop_distance).
        # لو stop_distance = 5% → partial exit عند +9% (1.8 × 5%).
        # لو stop_distance = 9% → partial exit عند +16.2% (1.8 × 9%).
        # ده بـ يـ adapt مع تذبذب السهم بدل الـ 7% الثابت.
        _stop_distance_pct = 0.0
        if entry_price > 0 and stop_loss_orig > 0 and entry_price > stop_loss_orig:
            _stop_distance_pct = ((entry_price - stop_loss_orig) / entry_price) * 100
        if _stop_distance_pct > 0:
            _profit_lock_pct = 1.8 * _stop_distance_pct  # 1.8R (EGX-STRATEGY)
        else:
            _profit_lock_pct = 7.0  # fallback لو stop مش متاح

        if entry_price <= 0 or stop_loss_orig <= 0 or stop_loss_orig >= entry_price:
            return None

        # ── Load 60 days BEFORE entry + post-entry bars for indicator computation ──
        created_at = prediction.get('created_at', '')
        try:
            start_date = created_at.split('T')[0] if 'T' in created_at else (
                created_at.split(' ')[0] if ' ' in created_at else created_at[:10])
        except Exception:
            start_date = datetime.now().strftime('%Y-%m-%d')

        try:
            lookback_date = (datetime.strptime(start_date, '%Y-%m-%d') - timedelta(days=80)).strftime('%Y-%m-%d')
        except Exception:
            lookback_date = start_date
        end_date = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        full_history = self.get_price_history(ticker, lookback_date, end_date)

        if len(full_history) < 25:
            # Not enough history to compute SMA20 → fallback to caller
            logger.info(f"[DailyCloser] #{pred_id} {ticker}: dynamic exit needs >=25 bars, got {len(full_history)} → fallback")
            return None

        # Find entry day index in full_history
        entry_idx = -1
        for i, bar in enumerate(full_history):
            if str(bar.get('date', '')) == start_date:
                entry_idx = i
                break
        if entry_idx < 0:
            # entry day not in history → use the bar closest to start_date
            for i, bar in enumerate(full_history):
                if str(bar.get('date', '')) >= start_date:
                    entry_idx = i
                    break
        if entry_idx < 0:
            return None

        max_days = 90  # universal dynamic exit window
        current_stop = stop_loss_orig
        current_target = target_price
        highest = entry_price
        lowest = entry_price
        notified_breakeven = False
        notified_hold = False
        days_below_sma20_running = 0

        self._ensure_exit_notifications_table()

        for j in range(entry_idx + 1, min(entry_idx + 1 + max_days, len(full_history))):
            day = full_history[j]
            day_date = str(day.get('date', ''))
            high = float(day.get('high', 0) or 0)
            low = float(day.get('low', 0) or 0)
            close = float(day.get('close', 0) or 0)
            if high <= 0 or low <= 0 or close <= 0:
                continue
            # P43-DATA-CLEAN sanity check (vs entry_price — catches splits)
            if high > entry_price * 5.0:
                high = 0.0
            if low > 0 and low < entry_price * 0.2:
                low = 0.0
            # P0-v16: daily-move sanity check (vs previous close — catches gradual pollution)
            # لو يوم واحد نزل > 50% من أمس أو طلع > 200% من أمس = split/feed error → skip
            if j > 0:
                _prev_close = float(full_history[j-1].get('close', 0) or 0)
                if _prev_close > 0:
                    if low > 0 and low < _prev_close * 0.5:
                        low = 0.0  # polluted low (50%+ single-day drop = split/error)
                    if high > 0 and high > _prev_close * 3.0:
                        high = 0.0  # polluted high (3× single-day spike = split/error)
                    # لو الـ close نفسه ملوّث (> 3× أمس) → skip اليوم كله (الـ trade يفضل pending)
                    if close > _prev_close * 3.0 or close < _prev_close * 0.33:
                        logger.warning(
                            f"[DataClean] {ticker} {day_date}: close={close} vs prev={_prev_close} "
                            f"→ polluted (3× move) → skip day"
                        )
                        continue
            if high <= 0 and low <= 0 and close <= 0:
                continue

            if high > 0:
                highest = max(highest, high)
            if low > 0:
                lowest = min(lowest, low)

            # ── Task part4-stop-loss: تأجيل stop لو قرب ينهي التصحيح ──
            # المالك: "لو السهم قرب على أنهاء التصحيح مش هانوقف خسارة لانة لسة هايزيد"
            # تحقق قبل Rule 1 HARD/DYNAMIC STOP — لو السهم بدأ يتعافى، نأجل ليوم واحد.
            try:
                _dyn_gain_pct = (close - entry_price) / entry_price * 100 if entry_price > 0 else 0
                if self._should_defer_stop_for_correction_end(
                    pred_id, ticker, day_date, close,
                    float(day.get('volume', 0) or 0), _dyn_gain_pct
                ):
                    continue  # skip stop-loss check for today — defer to next day
            except Exception as _defer_e:
                logger.warning(
                    f"[DailyCloser] #{pred_id} {ticker} {day_date}: defer-check failed: {_defer_e}"
                )

            # ── Rule 1: HARD/DYNAMIC STOP ──
            if low > 0 and low <= current_stop:
                actual_return = ((current_stop - entry_price) / entry_price * 100) if entry_price > 0 else 0
                if current_stop >= entry_price * 0.99:
                    exit_label = 'breakeven'; _status = 'CLOSED'
                elif current_stop > stop_loss_orig and current_stop < entry_price * 1.10:
                    exit_label = 'trailing_lock'; _status = 'CLOSED'
                else:
                    exit_label = 'stop_loss'; _status = 'STOPPED'
                self._log_exit_notification(
                    pred_id, ticker, 'EXIT_STOP',
                    f"خروج عند {exit_label} — السعر لمس الوقف الديناميكي",
                    current_price=current_stop, gain_pct=actual_return, day_number=j - entry_idx)
                return self._mark_closed(
                    pred_id, ticker, _status, actual_return,
                    highest, lowest, j - entry_idx, day_date,
                    exit_type=exit_label, highest_price_reached=highest,
                    lowest_price_reached=lowest, holding_days=j - entry_idx,
                    exit_close_price=current_stop)

            # ── Compute indicators using full window up to today ──
            ind = self._compute_dynamic_indicators(full_history, j)
            m5 = ind['momentum_5d']
            m20 = ind['momentum_20d']
            sma20 = ind['sma20']
            rsi = ind['rsi']
            gain_pct = (close - entry_price) / entry_price * 100 if entry_price > 0 else 0
            peak_gain_pct = (highest - entry_price) / entry_price * 100 if entry_price > 0 else 0

            # Track consecutive days below SMA20
            if sma20 > 0 and close < sma20:
                days_below_sma20_running += 1
            else:
                days_below_sma20_running = 0
            trend_intact = (sma20 > 0 and close > sma20) and (m5 >= -2.0)
            trend_broken = (days_below_sma20_running >= 2)
            momentum_strong = (m5 > 3.0) or (m20 > 8.0)
            momentum_dead = (m5 < -5.0) and (m20 < -3.0)

            # ── Rule 1.5: RL-FIX-17 PROFIT_LOCK (OWNER-MANDATE) ──────────────
            # المالك: "مجرد السهم يجيب المستهدف أو المكسب المطلوب نقفل الصفة"
            # لو gain_pct >= persona profit lock threshold → إغلاق كـ trailing_profit
            #
            # ── EGX-STRATEGY-STAGE3 (2026-08-30): "هل الحركة لسه مستمرة؟" ──
            # المالك طلب: "قبل ما النظام يقفل ربح صغير، يفحص إذا الحركة لسه حية."
            # المنطق الجديد:
            # 1. لو gain >= profit_lock + الحركة لسه مستمرة (زخم + حجم + ترند) → نكمل (Runner)
            # 2. لو gain >= profit_lock + الحركة بدأت تضعف → نقفل جزء أكبر
            # 3. لو gain >= profit_lock + الحركة ماتت → نقفل كامل
            # فحص الاستمرارية: momentum_5d > 2 + volume > avg + trend_intact
            _vol_today = float(day.get('volume', 0) or 0)
            _vol_avg_20 = 0
            try:
                _vol_window = [float(full_history[k].get('volume', 0) or 0) for k in range(max(0, j-20), j)]
                _vol_avg_20 = sum(_vol_window) / len(_vol_window) if _vol_window else 0
            except Exception:
                pass
            _vol_ratio_today = (_vol_today / _vol_avg_20) if _vol_avg_20 > 0 else 1.0
            _momentum_alive = (m5 > 2.0) and (_vol_ratio_today > 0.8) and trend_intact
            _momentum_weakening = (m5 < 0) or (not trend_intact) or (_vol_ratio_today < 0.6)

            _should_lock_profit = (
                gain_pct >= _profit_lock_pct
                and not (momentum_strong and trend_intact and target_price_2 > 0)
                # STAGE3: لو الحركة لسه مستمرة → نكمل (مش نقفل)
                and not (_momentum_alive and target_price_2 > 0)
            )
            # STAGE3: لو الحركة بتضعف + ربح >= profit_lock → نقفل كامل (مش جزئي)
            _should_full_exit = (
                gain_pct >= _profit_lock_pct
                and _momentum_weakening
            )
            if _should_lock_profit:
                actual_return = (close - entry_price) / entry_price * 100 if entry_price > 0 else 0
                # لو ربح >= profit_lock → exit كـ trailing_profit (ربح محقق)
                self._log_exit_notification(
                    pred_id, ticker, 'EXIT_PROFIT_LOCK',
                    f"خروج — تحقق الربح المستهدف للشخصية ({_persona}: +{_profit_lock_pct}%)",
                    current_price=close, gain_pct=actual_return, momentum_5d=m5,
                    momentum_20d=m20, sma20=sma20, rsi=rsi, day_number=j - entry_idx)
                return self._mark_closed(
                    pred_id, ticker, 'CLOSED', actual_return,
                    highest, lowest, j - entry_idx, day_date,
                    exit_type='trailing_profit', highest_price_reached=highest,
                    lowest_price_reached=lowest, holding_days=j - entry_idx,
                    exit_close_price=close)

            # ── Rule 1.7: RL-FIX-17 T1/T2 MULTI-TARGET (OWNER-MANDATE) ──────
            # المالك: "هدف أول وثانى عالشان لو السهم ناوى يطير ميضعش من أدينا"
            # لو وصلنا T1 (target_price) و T2 (target_price_2) موجود + زخم قوي →
            # ارفع current_target لـ T2 + حط stop عند T1 (حمي ربح T1) + notify
            if (target_price_2 > 0
                    and high >= target_price
                    and current_target < target_price_2
                    and momentum_strong
                    and trend_intact):
                _old_target = current_target
                current_target = target_price_2
                # رفع stop لـ target_price (T1) — حمي ربح T1
                if target_price > current_stop:
                    current_stop = target_price
                self._log_exit_notification(
                    pred_id, ticker, 'T1_HIT_T2_RAISE',
                    f"وصلنا الهدف الأول ({target_price:.2f})، نكمل للتاني ({target_price_2:.2f})",
                    current_price=close, gain_pct=gain_pct, momentum_5d=m5,
                    momentum_20d=m20, sma20=sma20, rsi=rsi,
                    old_target=_old_target, new_target=target_price_2,
                    day_number=j - entry_idx)

            # ── Rule 1.8: RL-FIX-17 T2_HIT → EXIT at target_price_2 ─────────
            # لو وصلنا T2 (target_price_2) → إغلاق كامل كـ target_hit
            if target_price_2 > 0 and high >= target_price_2:
                actual_return = (target_price_2 - entry_price) / entry_price * 100 if entry_price > 0 else 0
                self._log_exit_notification(
                    pred_id, ticker, 'EXIT_T2_HIT',
                    f"خروج — وصلنا الهدف الثاني ({target_price_2:.2f})",
                    current_price=target_price_2, gain_pct=actual_return, momentum_5d=m5,
                    momentum_20d=m20, sma20=sma20, rsi=rsi, day_number=j - entry_idx)
                return self._mark_closed(
                    pred_id, ticker, 'TARGET_HIT', actual_return,
                    highest, lowest, j - entry_idx, day_date,
                    exit_type='target_2_hit', highest_price_reached=highest,
                    lowest_price_reached=lowest, holding_days=j - entry_idx,
                    exit_close_price=target_price_2)

            # ── Rule 2: BREAKEVEN STOP — after gain >= 10% ──
            if peak_gain_pct >= 10.0 and current_stop < entry_price and not notified_breakeven:
                current_stop = entry_price
                notified_breakeven = True
                self._log_exit_notification(
                    pred_id, ticker, 'BREAKEVEN_LOCK',
                    "تم نقل الوقف لنقطة الدخول — رأس المال مضمون",
                    current_price=close, gain_pct=gain_pct, momentum_5d=m5,
                    momentum_20d=m20, sma20=sma20, rsi=rsi, day_number=j - entry_idx)

            # ── Rule 3: TRAILING PROFIT LOCK — after gain >= 40% ──
            if peak_gain_pct >= 40.0:
                trail_candidate = highest * 0.70
                if trail_candidate > current_stop:
                    current_stop = trail_candidate

            # ── Rule 4: TARGET+MOMENTUM → HOLD + RAISE TARGET + NOTIFY "كمل" ──
            if high >= current_target and momentum_strong and trend_intact:
                new_target = max(close * 1.15, entry_price * 1.50)
                if new_target > current_target:
                    self._log_exit_notification(
                        pred_id, ticker, 'HOLD_EXTEND',
                        "كمل — لسة فية زخم، المستهدف اترفع",
                        current_price=close, gain_pct=gain_pct, momentum_5d=m5,
                        momentum_20d=m20, sma20=sma20, rsi=rsi,
                        old_target=current_target, new_target=new_target,
                        day_number=j - entry_idx)
                    current_target = new_target
                # continue holding — DO NOT exit

            # ── Rule 5: DIP+ANALYSIS-OK → HOLD + NOTIFY "ثبّت" ──
            if gain_pct < 0 and trend_intact and m5 > -2.0 and not notified_hold:
                notified_hold = True
                self._log_exit_notification(
                    pred_id, ticker, 'HOLD_RECOVER',
                    "ثبّت — التحليل بيقول لسة فرصة، نكمل",
                    current_price=close, gain_pct=gain_pct, momentum_5d=m5,
                    momentum_20d=m20, sma20=sma20, rsi=rsi, day_number=j - entry_idx)
            if gain_pct >= 3.0:
                notified_hold = False  # reset so a new dip can notify again

            # ── Rule 6: TREND-BREAK after gain >= 5% → EXIT (lock profit) ──
            if trend_broken and gain_pct >= 5.0:
                actual_return = (close - entry_price) / entry_price * 100 if entry_price > 0 else 0
                self._log_exit_notification(
                    pred_id, ticker, 'EXIT_TREND_BREAK',
                    "خروج — الترند اتكسر (يومين تحت SMA20) بعد ربح",
                    current_price=close, gain_pct=actual_return, momentum_5d=m5,
                    momentum_20d=m20, sma20=sma20, rsi=rsi, day_number=j - entry_idx)
                return self._mark_closed(
                    pred_id, ticker, 'CLOSED', actual_return,
                    highest, lowest, j - entry_idx, day_date,
                    exit_type='trend_break', highest_price_reached=highest,
                    lowest_price_reached=lowest, holding_days=j - entry_idx,
                    exit_close_price=close)

            # ── Rule 7: MOMENTUM-DEAD → EXIT (get out while even/up) ──
            if momentum_dead and gain_pct >= 0:
                actual_return = (close - entry_price) / entry_price * 100 if entry_price > 0 else 0
                self._log_exit_notification(
                    pred_id, ticker, 'EXIT_MOMENTUM_DEAD',
                    "خروج — المومنتموم مات (5d<-5% و 20d<-3%)",
                    current_price=close, gain_pct=actual_return, momentum_5d=m5,
                    momentum_20d=m20, sma20=sma20, rsi=rsi, day_number=j - entry_idx)
                return self._mark_closed(
                    pred_id, ticker, 'CLOSED', actual_return,
                    highest, lowest, j - entry_idx, day_date,
                    exit_type='momentum_dead', highest_price_reached=highest,
                    lowest_price_reached=lowest, holding_days=j - entry_idx,
                    exit_close_price=close)

            # ── Rule 8: EXTREME-PROFIT → EXIT (doubled — take the win) ──
            # exit عند entry×2.0 بالظبط (+100%) مش عند close الملوّث.
            # ده بـ يـ cap الربح عند +100% و يـ prevent الـ split/artifact pollution.
            if gain_pct >= 100.0:
                _exit_px_100 = entry_price * 2.0
                actual_return = 100.0  # capped at +100%
                self._log_exit_notification(
                    pred_id, ticker, 'EXIT_TARGET_100PCT',
                    "خروج — وصلنا +100%! هدف الإ doubling تحقق",
                    current_price=_exit_px_100, gain_pct=actual_return, momentum_5d=m5,
                    momentum_20d=m20, sma20=sma20, rsi=rsi, day_number=j - entry_idx)
                return self._mark_closed(
                    pred_id, ticker, 'TARGET_HIT', actual_return,
                    highest, lowest, j - entry_idx, day_date,
                    exit_type='target_100pct', highest_price_reached=highest,
                    lowest_price_reached=lowest, holding_days=j - entry_idx,
                    exit_close_price=_exit_px_100)

            # ── Rule 9: TIME expiry ──
            if j - entry_idx >= max_days:
                actual_return = (close - entry_price) / entry_price * 100 if entry_price > 0 else 0
                return self._mark_closed(
                    pred_id, ticker, 'EXPIRED', actual_return,
                    highest, lowest, j - entry_idx, day_date,
                    exit_type='expired', highest_price_reached=highest,
                    lowest_price_reached=lowest, holding_days=j - entry_idx,
                    exit_close_price=close)

        return None  # Still pending — no exit triggered

    def _close_explosive_trend_follow(self, prediction: Dict, price_history: List[Dict]) -> Optional[CloseResult]:
        """P0-v15: سياسة خروج للأسهم الانفجارية — trend-following (SMA20).

        المنطق (مثبت بـ exit_policy_optimizer.py — Policy D):
          1. NO partial exit (مش زي partial_1r_trailing اللي بـ sell 50% عند 1R)
          2. Hard stop = الـ stop_loss الأصلي (15% للـ explosive)
          3. Trend exit: لو close < 20-day SMA AND gain >= 10% → exit (trend break)
          4. Max holding = 90 يوم (was 35) — خلي السهم يـ run لـ +50%/+100%
          5. Exit at the SMA crossover price (not a tight ATR trailing)

        النتيجة (backtest على 300 صفقة انفجارية حقيقية):
          - avg win: +13.28% (was +6.2% في production — ضعفين)
          - max gain: +76% (was capped at +10%)
          - PF: 0.94 (better than partial_1r_trailing 0.82)

        لو رجع None = لسه pending. لو رجع CloseResult = تم الإغلاق.
        """
        pred_id = prediction['id']
        ticker = prediction['ticker']
        entry_price = float(prediction.get('entry_price', 0) or 0)
        stop_loss = float(prediction.get('stop_loss', 0) or 0)
        signal = (prediction.get('signal', '') or '').upper()

        if entry_price <= 0 or stop_loss <= 0 or stop_loss >= entry_price:
            return None

        max_days = 90  # P0-v15: extended for explosive (was 35)
        created_at = prediction.get('created_at', '')
        try:
            start_date = created_at.split('T')[0] if 'T' in created_at else (
                created_at.split(' ')[0] if ' ' in created_at else created_at[:10])
        except Exception:
            start_date = datetime.now().strftime('%Y-%m-%d')

        # Build SMA20 window: we need 20 days of closes. Start from entry day.
        sma_window: List[float] = []
        highest_price_reached = entry_price
        lowest_price_reached = entry_price
        lowest_price = float('inf')

        for i, day in enumerate(price_history):
            if i >= max_days:
                break
            day_date = str(day.get('date', ''))
            if i == 0 and day_date == start_date:
                continue  # Skip prediction day

            high = float(day.get('high', 0) or 0)
            low = float(day.get('low', 0) or 0)
            close = float(day.get('close', 0) or 0)

            # P43-DATA-CLEAN: sanity check (same as mean-reversion path)
            if high > 0 and entry_price > 0 and high > entry_price * 5.0:
                high = 0.0
            if low > 0 and entry_price > 0 and low < entry_price * 0.2:
                low = 0.0

            if close <= 0:
                continue

            if high > 0:
                highest_price_reached = max(highest_price_reached, high)
            if low > 0:
                lowest_price_reached = min(lowest_price_reached, low)
                lowest_price = min(lowest_price, low)

            # 1. Check hard stop FIRST (explosive stop is 15%)
            # Phase 2 (V40): Skip stop check on ex-dividend day
            _is_ex_date = False
            try:
                _div_db = str(Path(__file__).resolve().parent.parent / 'db' / 'data_engine.db')
                if os.path.exists(_div_db):
                    _div_conn = sqlite3.connect(_div_db, timeout=5.0)
                    _div_row = _div_conn.execute('''
                        SELECT COUNT(*) as cnt FROM DividendCalendar
                        WHERE ticker = ? AND date(ex_dividend_date) = date(?)
                    ''', (ticker, day_date)).fetchone()
                    _div_conn.close()
                    if _div_row and _div_row[0] > 0:
                        _is_ex_date = True
            except Exception:
                _is_ex_date = False

            # ── Task part4-stop-loss: تأجيل stop لو قرب ينهي التصحيح ──
            # المالك: "لو السهم قرب على أنهاء التصحيح مش هانوقف خسارة لانة لسة هايزيد"
            # تحقق قبل hard stop الأسهم الانفجارية — لو السهم بدأ يتعافى، نأجل ليوم واحد.
            try:
                _exp_gain_pct = (close - entry_price) / entry_price * 100 if entry_price > 0 else 0
                if self._should_defer_stop_for_correction_end(
                    pred_id, ticker, day_date, close,
                    float(day.get('volume', 0) or 0), _exp_gain_pct
                ):
                    continue  # skip stop-loss check for today — defer to next day
            except Exception as _defer_e:
                logger.warning(
                    f"[DailyCloser] #{pred_id} {ticker} {day_date}: defer-check failed: {_defer_e}"
                )

            if low > 0 and low <= stop_loss and not _is_ex_date:
                actual_return = ((stop_loss - entry_price) / entry_price * 100) if entry_price > 0 else 0
                return self._mark_closed(
                    pred_id, ticker, 'STOPPED', actual_return,
                    highest_price_reached, lowest_price, i + 1,
                    day_date, exit_type='stop_loss',
                    highest_price_reached=highest_price_reached,
                    lowest_price_reached=lowest_price_reached,
                    holding_days=i + 1,
                )

            # 2. Build SMA20
            sma_window.append(close)
            if len(sma_window) > 20:
                sma_window = sma_window[-20:]

            # 3. Trend exit: close < SMA20 AND gain >= 10%
            if len(sma_window) >= 20:
                sma_20 = sum(sma_window) / len(sma_window)
                gain_pct = (highest_price_reached - entry_price) / entry_price * 100
                if gain_pct >= 10.0 and close < sma_20:
                    actual_return = ((close - entry_price) / entry_price * 100) if entry_price > 0 else 0
                    return self._mark_closed(
                        pred_id, ticker, 'CLOSED', actual_return,
                        highest_price_reached, lowest_price, i + 1,
                        day_date, exit_type='trend_exit',
                        highest_price_reached=highest_price_reached,
                        lowest_price_reached=lowest_price_reached,
                        holding_days=i + 1,
                    )

            days_elapsed = i + 1
            # 4. Expiry at 90 days
            if days_elapsed >= max_days:
                actual_return = ((close - entry_price) / entry_price * 100) if entry_price > 0 else 0
                return self._mark_closed(
                    pred_id, ticker, 'EXPIRED', actual_return,
                    highest_price_reached, lowest_price, days_elapsed,
                    day_date, exit_type='expired',
                    highest_price_reached=highest_price_reached,
                    lowest_price_reached=lowest_price_reached,
                    holding_days=days_elapsed,
                )

        return None  # Still pending — no exit triggered

    def _close_with_partial_trailing(self, prediction: Dict, price_history: List[Dict]) -> Optional[CloseResult]:
        """PRIORITY-2: إغلاق بسياسة partial at 1R + trailing على BUY signals.

        المنطق (نفس exit_policy_simulation.py):
          1. stop_loss الأصلي بيفضل الحارس قبل الـ partial
          2. لما high ≥ entry + 1R: بيع PARTIAL_FRACTION عند 1R
          3. بعد الـ partial: trailing_stop = highest - TRAIL_MULT × ATR
          4. لو close < trailing_stop: إغلاق الباقي
          5. actual_return = w × partial_ret + (1-w) × final_ret

        Returns CloseResult or None (still pending).
        """
        pred_id = prediction['id']
        ticker = prediction['ticker']
        entry_price = float(prediction.get('entry_price', 0) or 0)
        target_price = float(prediction.get('target_price', 0) or 0)
        stop_loss = float(prediction.get('stop_loss', 0) or 0)
        signal = (prediction.get('signal', '') or '').upper()

        if entry_price <= 0 or stop_loss <= 0 or stop_loss >= entry_price:
            # invalid for partial logic — fall back to caller's default path
            return None

        # ATR at entry (for trailing)
        atr_at_entry = float(prediction.get('atr_at_entry', 0) or 0)
        if atr_at_entry <= 0:
            start_date = prediction.get('created_at', '')[:10]
            atr_at_entry = self._compute_atr_at_entry(ticker, start_date)
        if atr_at_entry <= 0:
            # No ATR → can't trail → fall back to caller's default path
            logger.info(f"[DailyCloser] #{pred_id} {ticker}: partial mode needs ATR, none available → fallback")
            return None

        risk = entry_price - stop_loss          # 1R distance
        target_1r = entry_price + risk           # price at 1R
        partial_fraction = EXIT_PARTIAL_FRACTION
        trail_mult = EXIT_TRAIL_MULT

        # Holding days
        regime = str(prediction.get('regime', 'range') or 'range')
        conviction = float(prediction.get('score', prediction.get('conviction', 50)) or 50)
        max_holding_days = int(get_max_holding_days(regime=regime, conviction=conviction) * 1.5)

        # Walk candles
        highest_price_reached = entry_price
        lowest_price_reached = entry_price
        partial_done = False
        partial_exit_price = 0.0
        partial_return_pct = 0.0
        trailing_stop = stop_loss  # before partial, the fixed stop is the guard
        # AXIS-5: Rocket trailing state — _rocket_activated flips True when the
        # 3%-profit gate fires (earlier than 1R); _rocket_trail_mult holds the
        # tighter ATR multiple (default 2.0×, configurable via engine_settings).
        # If the 3% gate never fires, _rocket_activated stays False and the
        # trailing update falls back to the standard trail_mult (EXIT_TRAIL_MULT).
        _rocket_activated = False
        _rocket_trail_mult = trail_mult  # default; overwritten inside the 3% gate
        created_at = prediction.get('created_at', '')
        try:
            start_date = created_at.split('T')[0] if 'T' in created_at else (
                created_at.split(' ')[0] if ' ' in created_at else created_at[:10])
        except Exception:
            start_date = datetime.now().strftime('%Y-%m-%d')

        for i, day in enumerate(price_history):
            day_date = str(day.get('date', ''))
            if day_date == start_date:
                continue  # skip entry day

            high = float(day.get('high', 0) or 0)
            low = float(day.get('low', 0) or 0)
            close = float(day.get('close', 0) or 0)

            # P43-DATA-CLEAN: filter astronomical values
            if high > entry_price * 5.0 or (low > 0 and low < entry_price * 0.2):
                logger.warning(f"[DataClean] {ticker} {day_date}: extreme value — skip")
                continue

            if high > 0:
                highest_price_reached = max(highest_price_reached, high)
            if low > 0:
                lowest_price_reached = min(lowest_price_reached, low)

            days_elapsed = i + 1

            # ── Task part4-stop-loss: تأجيل stop لو قرب ينهي التصحيح ──
            # المالك: "لو السهم قرب على أنهاء التصحيح مش هانوقف خسارة لانة لسة هايزيد"
            # تحقق قبل partial pre-stop — لو السهم بدأ يتعافى، نأجل ليوم واحد.
            try:
                _part_gain_pct = (close - entry_price) / entry_price * 100 if entry_price > 0 else 0
                if self._should_defer_stop_for_correction_end(
                    pred_id, ticker, day_date, close,
                    float(day.get('volume', 0) or 0), _part_gain_pct
                ):
                    continue  # skip stop-loss check for today — defer to next day
            except Exception as _defer_e:
                logger.warning(
                    f"[DailyCloser] #{pred_id} {ticker} {day_date}: defer-check failed: {_defer_e}"
                )

            # 1) Check stop FIRST (before partial) — conservative
            if not partial_done and low <= stop_loss:
                logger.info(f"[DailyCloser] #{pred_id} {ticker}: STOPPED before partial (low={low} ≤ stop={stop_loss})")
                actual_return = ((stop_loss - entry_price) / entry_price * 100)
                return self._mark_closed_partial(pred_id, ticker, 'STOPPED', actual_return,
                                                  highest_price_reached, lowest_price_reached,
                                                  days_elapsed, day_date, exit_type='stop_loss',
                                                  exit_close_price=stop_loss,
                                                  highest_price_reached_val=highest_price_reached,
                                                  lowest_price_reached_val=lowest_price_reached,
                                                  partial_done=False, partial_exit_price=0,
                                                  partial_return_pct=0)

            # ── AXIS-5: Rocket trailing — activate at 3% profit (earlier than 1R) ──
            # المالك طلب: "trailing stop يبدأ عند ≥3% ربح" (مش 1R). الـ 3% بتتحقق
            # قبل 1R لما stop_loss يكون قريب. هنا بنفعل الـ trailing بـ 2.0×ATR
            # (أضيق من 2.5×ATR القياسي) عشان نـ lock الربح بدري على الصواريخ.
            # لو الـ 3% اشتغلت، partial_done بقا True → الـ 1R block تحت بـ يتـ skip.
            current_return_pct = ((high - entry_price) / entry_price * 100) if entry_price > 0 else 0
            if not partial_done and current_return_pct >= 3.0 and atr_at_entry > 0:
                # Activate trailing at 3% profit with tighter 2.0×ATR (rocket mode)
                _rocket_trail_mult = float(get_setting('rocket_trailing_atr_mult', default=2.0))
                _rocket_activated = True
                partial_done = True
                partial_exit_price = entry_price * 1.03  # mark partial at 3% level
                partial_return_pct = 3.0
                trailing_stop = highest_price_reached - _rocket_trail_mult * atr_at_entry
                logger.info(f"[DailyCloser] #{pred_id} {ticker}: ROCKET TRAILING at 3% (high={high}, "
                            f"ret={current_return_pct:.2f}%), trail_mult={_rocket_trail_mult}, trailing={trailing_stop:.2f}")

            # 2) Check partial trigger (high ≥ 1R) — fallback for non-rocket trades
            if not partial_done and high >= target_1r:
                partial_done = True
                partial_exit_price = target_1r
                partial_return_pct = ((target_1r - entry_price) / entry_price * 100)
                # Activate trailing
                trailing_stop = highest_price_reached - trail_mult * atr_at_entry
                logger.info(f"[DailyCloser] #{pred_id} {ticker}: PARTIAL at 1R={target_1r:.2f} "
                            f"(ret={partial_return_pct:.2f}%), trailing={trailing_stop:.2f}")

            # 3) After partial: check trailing stop
            if partial_done:
                # AXIS-5: لو الـ 3% rocket gate هو اللي فعّل الـ trailing، نستخدم
                # _rocket_trail_mult (2.0×ATR) بدل trail_mult القياسي.
                _active_trail_mult = _rocket_trail_mult if _rocket_activated else trail_mult
                new_trail = highest_price_reached - _active_trail_mult * atr_at_entry
                trailing_stop = max(trailing_stop, new_trail)
                # 🔥 P0-v3 BUGFIX: الـ trailing_stop لازم يكون FLOORED عند entry
                # (breakeven) — مش CAPPED. الكود القديم كان `if trailing_stop >
                # entry: trailing_stop = entry` → ده كان بـ يـ cap الـ trailing
                # عند breakeven للأبد → الـ "let it run for +15-20%" ما كانش
                # ممكن يحصل أبداً. التصحيح: max(trailing_stop, entry) = الـ floor
                # عند breakeven + الـ trailing بـ يرتفع مع highest → بـ يـ lock
                # في الربح فوق entry. ده بـ يحقق تكليف المالك: "نقل الـ Stop Loss
                # تلقائياً إلى سعر الدخول (Breakeven)" + "ترك الـ 50% المتبقية
                # لتتحرك مع اتجاه السهم للوصول لأهداف كبيرة (+15% إلى +20%)".
                trailing_stop = max(trailing_stop, entry_price)

                if close < trailing_stop:
                    final_return = ((close - entry_price) / entry_price * 100)
                    actual_return = (partial_fraction * partial_return_pct
                                     + (1 - partial_fraction) * final_return)
                    logger.info(f"[DailyCloser] #{pred_id} {ticker}: TRAILING EXIT close={close} "
                                f"< trail={trailing_stop:.2f} → blended={actual_return:.2f}%")
                    return self._mark_closed_partial(pred_id, ticker, 'TARGET_HIT', actual_return,
                                                      highest_price_reached, lowest_price_reached,
                                                      days_elapsed, day_date, exit_type='partial_trailing',
                                                      exit_close_price=close,
                                                      highest_price_reached_val=highest_price_reached,
                                                      lowest_price_reached_val=lowest_price_reached,
                                                      partial_done=True, partial_exit_price=partial_exit_price,
                                                      partial_return_pct=partial_return_pct)

            # 3.45) CHANGE OF CHARACTER (CHoCH) — UNIFIED-LOGIC (2026-08-30)
            # المنطق الموحد المطلوب من المالك: "لو حصل تصريف واضح أو Change of Character → خروج".
            # كشف تغيّر السلوك: لو في 3 أيام متتالية نزول + حجم بيعي (vol > avg × 1.2 + change < 0)
            # أو لو السهم نزل تحت lower Bollinger Band → تصريف واضح → exit فوري.
            # ده بـ يحمي الصفقة من الـ slow bleed ويطلّع رأس المال بدري.
            try:
                CHOCH_MIN_DAYS = 3  # 3 أيام متتالية نزول
                CHOCH_VOL_SELL_RATIO = 1.2  # vol > avg × 1.2 + change < 0 = بيعي
                if days_elapsed >= CHOCH_MIN_DAYS and len(daily_history) >= CHOCH_MIN_DAYS:
                    _last_3 = daily_history[-3:] if len(daily_history) >= 3 else daily_history
                    _choch_dropping = all(
                        (float(d.get('close', d.get('close_price', 0)) or 0) <
                         float(daily_history[-4].get('close', daily_history[-4].get('close_price', 0)) or 0))
                        if i > 0 or len(daily_history) > 3 else False
                        for i, d in enumerate(_last_3)
                    )
                    # طريقة أبسط: لو آخر 3 closes كلها نازلة مقارنة بـ close[-4]
                    if len(daily_history) >= 4:
                        _c0 = float(daily_history[-4].get('close', daily_history[-4].get('close_price', 0)) or 0)
                        _c1 = float(daily_history[-3].get('close', daily_history[-3].get('close_price', 0)) or 0)
                        _c2 = float(daily_history[-2].get('close', daily_history[-2].get('close_price', 0)) or 0)
                        _c3 = float(daily_history[-1].get('close', daily_history[-1].get('close_price', 0)) or 0)
                        # 3 أيام نزول متتالية (c1<c0, c2<c1, c3<c2)
                        _choch_dropping = (_c0 > 0 and _c1 > 0 and _c2 > 0 and _c3 > 0
                                           and _c1 < _c0 and _c2 < _c1 and _c3 < _c2)
                        # فلتر الحجم البيعي: vol آخر 3 أيام > avg × 1.2
                        _vols_3 = [
                            float(d.get('volume', d.get('volume_traded', 0)) or 0)
                            for d in daily_history[-3:]
                        ]
                        _avg_vol_20_arr = [
                            float(d.get('volume', d.get('volume_traded', 0)) or 0)
                            for d in daily_history[-20:]
                        ] if len(daily_history) >= 20 else _vols_3
                        _avg_vol_20 = (sum(_avg_vol_20_arr) / len(_avg_vol_20_arr)) if _avg_vol_20_arr else 0
                        _vol_sellish = (_avg_vol_20 > 0 and
                                        sum(_vols_3) / 3 > _avg_vol_20 * CHOCH_VOL_SELL_RATIO)
                        # لو نزول 3 أيام + حجم بيعي → CHoCH → exit
                        if _choch_dropping and _vol_sellish:
                            final_return = ((close - entry_price) / entry_price * 100) if close > 0 and entry_price > 0 else 0
                            if partial_done:
                                actual_return = (partial_fraction * partial_return_pct
                                                 + (1 - partial_fraction) * final_return)
                                exit_type = 'partial_choch'
                                status = 'TARGET_HIT' if actual_return > 0 else 'EXPIRED'
                            else:
                                actual_return = final_return
                                exit_type = 'choch_distribution'
                                status = 'EXPIRED'
                            logger.info(f"[DailyCloser] #{pred_id} {ticker}: CHoCH EXIT "
                                        f"(3d drop + vol>{CHOCH_VOL_SELL_RATIO}× avg) → ret={actual_return:.2f}%")
                            return self._mark_closed_partial(pred_id, ticker, status, actual_return,
                                                              highest_price_reached, lowest_price_reached,
                                                              days_elapsed, day_date, exit_type=exit_type,
                                                              exit_close_price=close or entry_price,
                                                              highest_price_reached_val=highest_price_reached,
                                                              lowest_price_reached_val=lowest_price_reached,
                                                              partial_done=partial_done,
                                                              partial_exit_price=partial_exit_price,
                                                              partial_return_pct=partial_return_pct)
            except Exception as _choch_err:
                logger.debug(f"CHoCH check failed for #{pred_id} {ticker}: {_choch_err}")

            # 3.5) STUCK TRADE / TIME EXIT (2026-08-28)
            # Analyst advice: if trade held 5+ days with < 1.5% movement → exit (stuck).
            # Slow bleed pattern: 19/28 losses in last 30 days were slow bleeds (10-23 days).
            # These dead trades tie up capital and eventually hit stop.
            # Exit early to free capital + cut losses.
            STUCK_MIN_DAYS = 5
            STUCK_MAX_MOVEMENT_PCT = 1.5  # < 1.5% movement = stuck
            if days_elapsed >= STUCK_MIN_DAYS:
                movement_pct = abs((close - entry_price) / entry_price * 100) if entry_price > 0 and close > 0 else 0
                if movement_pct < STUCK_MAX_MOVEMENT_PCT:
                    # Trade is stuck — no significant movement in 5+ days
                    final_return = ((close - entry_price) / entry_price * 100) if close > 0 else 0
                    if partial_done:
                        actual_return = (partial_fraction * partial_return_pct
                                         + (1 - partial_fraction) * final_return)
                        exit_type = 'partial_stuck'
                        status = 'TARGET_HIT' if actual_return > 0 else 'EXPIRED'
                    else:
                        actual_return = final_return
                        exit_type = 'stuck_no_movement'
                        status = 'EXPIRED'
                    logger.info(f"[DailyCloser] #{pred_id} {ticker}: STUCK EXIT after {days_elapsed}d "
                                f"(movement={movement_pct:.2f}% < {STUCK_MAX_MOVEMENT_PCT}%), ret={actual_return:.2f}%")
                    return self._mark_closed_partial(pred_id, ticker, status, actual_return,
                                                      highest_price_reached, lowest_price_reached,
                                                      days_elapsed, day_date, exit_type=exit_type,
                                                      exit_close_price=close or entry_price,
                                                      highest_price_reached_val=highest_price_reached,
                                                      lowest_price_reached_val=lowest_price_reached,
                                                      partial_done=partial_done,
                                                      partial_exit_price=partial_exit_price,
                                                      partial_return_pct=partial_return_pct)

            # 4) Check max holding days
            if days_elapsed >= max_holding_days:
                final_return = ((close - entry_price) / entry_price * 100) if close > 0 else 0
                if partial_done:
                    actual_return = (partial_fraction * partial_return_pct
                                     + (1 - partial_fraction) * final_return)
                    exit_type = 'partial_expired'
                    status = 'TARGET_HIT' if actual_return > 0 else 'EXPIRED'
                else:
                    actual_return = final_return
                    exit_type = 'expired'
                    status = 'EXPIRED'
                logger.info(f"[DailyCloser] #{pred_id} {ticker}: EXPIRED after {days_elapsed}d, ret={actual_return:.2f}%")
                return self._mark_closed_partial(pred_id, ticker, status, actual_return,
                                                  highest_price_reached, lowest_price_reached,
                                                  days_elapsed, day_date, exit_type=exit_type,
                                                  exit_close_price=close or entry_price,
                                                  highest_price_reached_val=highest_price_reached,
                                                  lowest_price_reached_val=lowest_price_reached,
                                                  partial_done=partial_done,
                                                  partial_exit_price=partial_exit_price,
                                                  partial_return_pct=partial_return_pct)

        # Still pending
        return None

    def _mark_closed_partial(self, pred_id, ticker, status, actual_return, highest, lowest,
                              days, close_date, exit_type='', exit_close_price=0.0,
                              highest_price_reached_val=0.0, lowest_price_reached_val=0.0,
                              partial_done=False, partial_exit_price=0.0, partial_return_pct=0.0):
        """Mark closed with partial-exit metadata (PRIORITY-2)."""
        # First call the standard _mark_closed to record the main outcome
        result = self._mark_closed(
            pred_id, ticker, status, actual_return, highest, lowest, days, close_date,
            exit_type=exit_type, highest_price_reached=highest_price_reached_val,
            lowest_price_reached=lowest_price_reached_val, exit_close_price=exit_close_price,
        )
        # Then UPDATE the partial-specific columns
        try:
            conn = self._conn(self.predictions_db)
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE predictions
                SET partial_exit_price = ?,
                    partial_exit_date = ?,
                    partial_return_pct = ?,
                    exit_policy = 'partial_1r_trailing'
                WHERE id = ?
            """, (
                round(partial_exit_price, 2) if partial_done else None,
                close_date if partial_done else None,
                round(partial_return_pct, 2) if partial_done else None,
                pred_id,
            ))
            conn.commit()
            conn.close()
        except Exception as e:
            logger.warning(f"[DailyCloser] partial metadata write failed for #{pred_id}: {e}")

        return result

    def close_prediction(self, prediction: Dict) -> Optional[CloseResult]:
        """إغلاق توقع واحد بناءً على تاريخ الأسعار — مع دعم Trend-Following"""
        pred_id = prediction['id']
        ticker = prediction['ticker']
        entry_price = float(prediction.get('entry_price', 0) or 0)
        target_price = float(prediction.get('target_price', 0) or 0)
        stop_loss = float(prediction.get('stop_loss', 0) or 0)
        created_at = prediction.get('created_at', '')

        # ─ـ CLOSED-LOOP LOG (إلزامي — القاعدة 13): ──
        # log واضح لكل صف بـ يفحصه عشان المستخدم يقدر يتتبع ليه مفيش إغلاق.
        # قبل كده كان silent → "closed=0" بدون سبب واضح.
        _signal = prediction.get('signal', '') or ''
        _persona = prediction.get('persona', '') or ''
        logger.info(
            f"[DailyCloser] examining #{pred_id} {ticker} signal={_signal} "
            f"persona={_persona} entry={entry_price} target={target_price} "
            f"stop={stop_loss} created_at={created_at}"
        )

        if entry_price <= 0:
            logger.warning(f"[DailyCloser] #{pred_id} {ticker}: entry_price<=0 — skip")
            return None

        # Determine if this is a trend-following trade
        is_trend_following = bool(prediction.get('is_trend_following', 0))
        exit_type_flag = (prediction.get('exit_type', '') or '').strip().lower()

        # Determine max holding days — ديناميكي حسب الـ regime
        regime = str(prediction.get('regime', 'range') or 'range')
        conviction = float(prediction.get('score', prediction.get('conviction', 50)) or 50)
        base_max = get_max_holding_days(regime=regime, conviction=conviction)
        max_holding_days = int(base_max * 1.5) if (is_trend_following or exit_type_flag == 'trailing_stop') else base_max

        # Determine start date (day after prediction)
        try:
            if 'T' in created_at:
                start_date = created_at.split('T')[0]
            elif ' ' in created_at:
                start_date = created_at.split(' ')[0]
            else:
                start_date = created_at[:10]
        except Exception:
            start_date = datetime.now().strftime('%Y-%m-%d')

        end_date = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')

        # Get price history
        price_history = self.get_price_history(ticker, start_date, end_date)

        if not price_history:
            # No daily price history available.
            #
            # 🔥 VERIFY-FIX-2 (EOD-only closing): لو إحنا جوه ساعات الجلسة
            # (10:00-14:30 Cairo)، **ممنوع** نـ fall back للسعر اللحظي. قبل كده
            # كان الكود بـ يقفل التوقع على لمسة لحظية للهدف الساعة 11 الصبح،
            # بس السهم ممكن يقفل أحمر آخر اليوم → إحصائيات مغلوطة. دلوقتي
            # التوقع بـ يفضل pending لحد ما الـ EOD closer يشتغل بعد 14:30
            # على الـ daily bars الحقيقية.
            #
            # الـ live-price fallback بـ يشتغل بس post-market (≥14:30) أو في
            # أيام الإجازة، حيث السعر اللحظي ≈ آخر سعر إغلاق متاح.
            if _is_egx_market_hours_now():
                logger.info(
                    f"[DailyCloser] #{pred_id} {ticker} STAYS PENDING (market hours, no daily bars yet) — "
                    f"will close at EOD on real closing price"
                )
                return None

            # Post-market / weekend: fall back to CURRENT price (from stocks.db)
            # to evaluate + PERSIST the outcome. ده ضروري عشان الـ loop ما
            # يفضلش معلّق للأبد لو مفيش تاريخ أسعار يومي. الـ outcome بـ يتقفل
            # (يتكتب في outcome_date/actual_return/is_correct) عشان الشاشة تقدر
            # تحسب نسبة صادقة على المقفل فقط.
            current_price = self._get_current_price_stocks(ticker)
            try:
                pred_date = datetime.strptime(start_date, '%Y-%m-%d')
                days_elapsed = (datetime.now() - pred_date).days
            except Exception:
                days_elapsed = 0

            if current_price > 0 and entry_price > 0:
                # CRITICAL FIX (2026-08-15): Determine direction from target/stop structure.
                # HOLD signals have BUY-style targets (target above entry) but signal='HOLD'.
                # Old code treated HOLD as SELL → false TARGET_HIT closures (live <= target
                # always true when target is above entry).
                _sig_upper = (prediction.get('signal', '') or '').upper()
                if target_price and target_price > 0 and entry_price and entry_price > 0:
                    is_buy = target_price > entry_price  # target above entry = BUY direction
                else:
                    is_buy = _sig_upper in ('BUY', 'STRONG_BUY', 'ACCUMULATE')
                if is_buy:
                    if target_price > 0 and current_price >= target_price:
                        ret = ((current_price - entry_price) / entry_price * 100)
                        return self._mark_closed(pred_id, ticker, 'TARGET_HIT', ret,
                                                  current_price, current_price, max(1, days_elapsed),
                                                  datetime.now().strftime('%Y-%m-%d'),
                                                  exit_type='target_hit', exit_close_price=current_price,
                                                  highest_price_reached=current_price,
                                                  lowest_price_reached=current_price)
                    if stop_loss > 0 and current_price <= stop_loss:
                        ret = ((current_price - entry_price) / entry_price * 100)
                        return self._mark_closed(pred_id, ticker, 'STOPPED', ret,
                                                  current_price, current_price, max(1, days_elapsed),
                                                  datetime.now().strftime('%Y-%m-%d'),
                                                  exit_type='stop_loss', exit_close_price=current_price,
                                                  highest_price_reached=current_price,
                                                  lowest_price_reached=current_price)
                else:  # SELL
                    if target_price > 0 and current_price <= target_price:
                        ret = ((entry_price - current_price) / entry_price * 100)
                        return self._mark_closed(pred_id, ticker, 'TARGET_HIT', ret,
                                                  current_price, current_price, max(1, days_elapsed),
                                                  datetime.now().strftime('%Y-%m-%d'),
                                                  exit_type='target_hit', exit_close_price=current_price,
                                                  highest_price_reached=current_price,
                                                  lowest_price_reached=current_price)
                    if stop_loss > 0 and current_price >= stop_loss:
                        ret = ((entry_price - current_price) / entry_price * 100)
                        return self._mark_closed(pred_id, ticker, 'STOPPED', ret,
                                                  current_price, current_price, max(1, days_elapsed),
                                                  datetime.now().strftime('%Y-%m-%d'),
                                                  exit_type='stop_loss', exit_close_price=current_price,
                                                  highest_price_reached=current_price,
                                                  lowest_price_reached=current_price)

            # No current price either — check if max days have passed → EXPIRED
            if days_elapsed >= max_holding_days:
                return self._mark_expired(pred_id, ticker, entry_price, days_elapsed)
            # ─ـ CLOSED-LOOP LOG: ليه الصف فضل PENDING (no history branch) ──
            # log واضح: مفيش price history (bars أكبر من يوم التوقع) و لا
            # الـ live price لمس target/stop و لا الـ days وصلت لـ max.
            logger.info(
                f"[DailyCloser] #{pred_id} {ticker} STAYS PENDING (no future bars) — "
                f"live={current_price} target={target_price} stop={stop_loss} "
                f"days_elapsed={days_elapsed} max_days={max_holding_days} "
                f"price_history_last={price_history[-1].get('date') if price_history else 'none'}"
            )
            return None  # Still pending — not enough data/time

        # ── Trend-Following path: use trailing stop logic ──
        if is_trend_following or exit_type_flag == 'trailing_stop':
            # Compute ATR at entry
            atr_at_entry = float(prediction.get('atr_at_entry', 0) or 0)
            if atr_at_entry <= 0:
                atr_at_entry = self._compute_atr_at_entry(ticker, start_date)

            # Try trailing stop check
            result = self.check_trailing_stop(prediction, price_history, atr_at_entry)
            if result:
                return result

            # If trailing stop not breached, check expiry with extended max days
            # (handled inside check_trailing_stop)
            return None

        # ── 🔥 VERIFY-RL: Multi-Target Exit (T1/T2/T3 + dynamic stop) ──────
        # سياسة الخروج الجديدة المطلوبة من المالك:
        #   - هدف أول/تاني/تالت (T1/T2/T3) مع partial sales
        #   - وقف خسارة ديناميكي (trailing + volatility-expand)
        #   - reinforcement learning من الصفقات الجيدة (hold-through + target-raise)
        # بـ تـ trigger بس لو prediction['exit_policy'] == 'multi_target'.
        # لو رجعت result.exited=True → نـ mark as closed.
        # لو رجعت False → fall through للـ policies التالية (dynamic/explosive/partial).
        # ده zero-blast-radius: التوقعات القديمة (exit_policy='fixed' افتراضياً)
        # ما بـ تـأثرش.
        _exit_policy = (prediction.get('exit_policy', '') or 'fixed').strip().lower()
        if _exit_policy == 'multi_target':
            try:
                import sys as _mt_sys
                _vps = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                if _vps not in _mt_sys.path:
                    _mt_sys.path.insert(0, _vps)
                from portfolio.multi_target_exit import attach_to_prediction as _mt_attach
                from utils.win_lesson_store import (
                    compute_t1_holdthrough_bias as _calc_hold_bias,
                    compute_bounded_target_raise as _calc_raise_r,
                )
                # اقرأ win-lesson bias + target-raise من learned_lessons
                _persona_mt = (prediction.get('persona', 'balanced') or 'balanced').lower()
                _hold_bias = _calc_hold_bias(_persona_mt)
                _raise_r = _calc_raise_r(_persona_mt)

                # entry_idx: index of entry day in price_history
                _entry_idx_mt = -1
                for i, bar in enumerate(price_history):
                    if str(bar.get('date', '')) == start_date:
                        _entry_idx_mt = i
                        break
                    if str(bar.get('date', '')) >= start_date:
                        _entry_idx_mt = i
                        break

                if _entry_idx_mt >= 0 and _entry_idx_mt < len(price_history) - 1:
                    _mt_result = _mt_attach(
                        prediction=prediction,
                        price_history=price_history,
                        entry_idx=_entry_idx_mt,
                        holdthrough_bias=_hold_bias,
                        target_raise_r=_raise_r,
                    )
                    if _mt_result and _mt_result.exited:
                        # املا الـ CloseResult بنفس shape الـ daily_closer بـ يستخدمه
                        _is_buy_mt = (prediction.get('signal', '') or '').upper() in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
                        _mt_status = 'TARGET_HIT' if _mt_result.realized_return_pct > 0 else 'STOPPED'
                        if _mt_result.exit_type == 'expired':
                            _mt_status = 'EXPIRED'
                        logger.info(
                            f"[DailyCloser] #{pred_id} {ticker}: MULTI-TARGET exit "
                            f"(type={_mt_result.exit_type}, return={_mt_result.realized_return_pct:.2f}%, "
                            f"days={_mt_result.days_to_exit}, T1={_mt_result.t1_hit} T2={_mt_result.t2_hit} T3={_mt_result.t3_hit}, "
                            f"highest={_mt_result.highest_price_reached:.2f}, "
                            f"hold_bias={_hold_bias}, raise_R={_raise_r})"
                        )
                        return self._mark_closed(
                            pred_id, ticker, _mt_status,
                            _mt_result.realized_return_pct,
                            _mt_result.highest_price_reached, 0.0,
                            max(1, _mt_result.days_to_exit),
                            _mt_result.exit_date,
                            exit_type=_mt_result.exit_type,
                            exit_close_price=_mt_result.exit_price,
                            highest_price_reached=_mt_result.highest_price_reached,
                            lowest_price_reached=0.0,
                        )
                    else:
                        logger.info(
                            f"[DailyCloser] #{pred_id} {ticker}: multi-target not triggered yet "
                            f"(still pending) → fall through to next policy"
                        )
                # لو _mt_attach رجع None أو not exited → continue للـ policies التالية
            except Exception as _mt_err:
                logger.warning(f"[DailyCloser] #{pred_id} {ticker}: multi-target exit error ({_mt_err}) → fall through")

        # ── P0-v16: Universal Dynamic Exit (PRIMARY — لكل BUY signals) ──
        # ده المنطق اللي المالك طلبه: لو السهم وصل المستهدف بس لسة فية زخم → كمل + ارفع
        # المستهدف + تنبيه. لو نزل بس التحليل كويس → ثبّت + تنبيه. الربح مضمون بـ
        # breakeven + trailing lock. بـ يـ apply على كل الأسهم مش بس الانفجارية.
        # مثبت بـ dynamic_exit_optimizer.py: avg win +14.4% (ضعف partial), max +102%.
        # لو رجع None (not enough history) → fallback للـ explosive/partial paths.
        _sig_dyn = (prediction.get('signal', '') or '').upper()
        # ── Task 11: geometric is_buy (target>entry=BUY-style) ──
        # بـ يخلّي HOLD signals اللي ليها BUY-style targets تستخدم dynamic exit.
        if target_price > 0 and entry_price > 0:
            _is_buy_dyn = target_price > entry_price
        else:
            _is_buy_dyn = _sig_dyn in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
        if _is_buy_dyn:
            _dyn_result = self._close_with_dynamic_exit(prediction, price_history)
            if _dyn_result:
                logger.info(
                    f"[DailyCloser] #{pred_id} {ticker}: DYNAMIC exit "
                    f"(return={_dyn_result.actual_return:.2f}%, "
                    f"highest={_dyn_result.highest_price_reached:.2f}, "
                    f"type={_dyn_result.exit_type})"
                )
                return _dyn_result
            # لو رجع None = لسه pending OR history غير كافية → fallback للـ paths التالية
            logger.info(f"[DailyCloser] #{pred_id} {ticker}: dynamic exit fallback (pending or <25 bars) → next path")

        # ── P0-v15: Explosive trend-follow exit (BEFORE partial 1R) ──
        # الأسهم الانفجارية (stop > 10% أو target > 25%) لازم سياسة خروج مختلفة:
        # trend-follow (SMA20) + 90-day max + NO partial. ده بـ let الفايزين
        # يـ run لـ +50%/+100% بدل ما الـ partial_1r_trailing يـ capهم عند +7%.
        # (مثبت بـ exit_policy_optimizer.py — avg win +6.2% → +13.28%)
        _sig = (prediction.get('signal', '') or '').upper()
        # ── Task 11: geometric is_buy for explosive path ──
        if target_price > 0 and entry_price > 0:
            _is_buy_signal = target_price > entry_price
        else:
            _is_buy_signal = _sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
        if _is_buy_signal and self._is_explosive_prediction(prediction):
            _explosive_result = self._close_explosive_trend_follow(prediction, price_history)
            if _explosive_result:
                logger.info(
                    f"[DailyCloser] #{pred_id} {ticker}: EXPLOSIVE trend-follow exit "
                    f"(return={_explosive_result.actual_return:.2f}%, "
                    f"highest={_explosive_result.highest_price_reached:.2f}, "
                    f"type={_explosive_result.exit_type})"
                )
                return _explosive_result
            # لو رجع None = لسه pending (ما وصلش stop ولا SMA20 signal) → كمّل للـ partial path

        # ── PRIORITY-2: Partial at 1R + Trailing (ALL BUY when enabled) ──
        # يتطبّق على BUY signals لما EXIT_POLICY_MODE='partial_1r_trailing'.
        # السلوك القديم (target/stop fix) بيفضل للـ SELL/HOLD و لما الـ flag متقفل.
        _sig = (prediction.get('signal', '') or '').upper()
        # ── Task 11: geometric is_buy for partial path ──
        if target_price > 0 and entry_price > 0:
            _is_buy_for_partial = target_price > entry_price
        else:
            _is_buy_for_partial = _sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
        if EXIT_PARTIAL_ENABLED and _is_buy_for_partial:
            _partial_result = self._close_with_partial_trailing(prediction, price_history)
            if _partial_result:
                return _partial_result
            # لو رجع None (fallback — invalid stop / no ATR), كمّل للـ mean-reversion path
            logger.info(f"[DailyCloser] #{pred_id} {ticker}: partial mode fallback to fixed target/stop")

        # ── Mean-Reversion path: existing fixed target/stop logic ──
        highest_price = 0.0
        highest_price_reached = entry_price
        lowest_price = float('inf')
        lowest_price_reached = entry_price
        signal = prediction.get('signal', '').upper()
        # CRITICAL FIX (2026-08-15): Determine direction from target/stop structure.
        # HOLD signals have BUY-style targets (target above entry) but signal='HOLD'.
        # Old code treated HOLD as SELL → false TARGET_HIT closures on day 1
        # (live <= target always true when target is above entry).
        # Now: target above entry → BUY direction, target below entry → SELL direction.
        if target_price and target_price > 0 and entry_price and entry_price > 0:
            is_buy = target_price > entry_price  # robust against HOLD/mixed signals
        else:
            is_buy = signal in ('BUY', 'STRONG_BUY', 'buy', 'strong_buy', 't1_buy', 'swing_buy', 'ACCUMULATE')

        for i, day in enumerate(price_history):
            if i == 0 and day.get('date') == start_date:
                continue  # Skip the prediction day itself

            high = float(day.get('high', 0) or 0)
            low = float(day.get('low', 0) or 0)
            close = float(day.get('close', 0) or 0)

            # P43-DATA-CLEAN: Sanity Check — فلترة الأرقام الفلكية (Ticker Pollution / Stock Splits)
            # لو high أو low بيعدّي حد منطقي نسبةً لـ entry_price، ده خطأ قاعدة بيانات
            # (Stock Split بيسبب سعر 637 بدل 1.85 مثلًا). نتجاهل القيمة الخاطئة عشان
            # م تقفلش الصفقة كـ TARGET_HIT في نفس اليوم بأرقام كاذبة.
            # الحدود: high مش أكتر من 5x entry، low مش أقل من 0.2x entry.
            DATA_CLEAN_MAX_MULT = 5.0   # high > entry × 5 → مشكوك فيه
            DATA_CLEAN_MIN_MULT = 0.2   # low < entry × 0.2 → مشكوك فيه
            data_error_flag = False
            if high > 0 and entry_price > 0:
                if high > entry_price * DATA_CLEAN_MAX_MULT:
                    logger.warning(
                        f"[DataClean] {ticker} {day.get('date','')}: high={high} > entry×{DATA_CLEAN_MAX_MULT} "
                        f"(entry={entry_price}) — Ticker Pollution/Split suspected. Ignoring high."
                    )
                    high = 0.0  # تجاهل القيمة الخاطئة
                    data_error_flag = True
                elif low > 0 and low > entry_price * DATA_CLEAN_MAX_MULT:
                    logger.warning(
                        f"[DataClean] {ticker} {day.get('date','')}: low={low} > entry×{DATA_CLEAN_MAX_MULT} "
                        f"(entry={entry_price}) — Data pollution. Ignoring low."
                    )
                    low = 0.0
                    data_error_flag = True
            if low > 0 and entry_price > 0 and low < entry_price * DATA_CLEAN_MIN_MULT:
                logger.warning(
                    f"[DataClean] {ticker} {day.get('date','')}: low={low} < entry×{DATA_CLEAN_MIN_MULT} "
                    f"(entry={entry_price}) — Data pollution. Ignoring low."
                )
                low = 0.0
                data_error_flag = True

            if high > 0:
                highest_price = max(highest_price, high)
                highest_price_reached = max(highest_price_reached, high)
            if low > 0:
                lowest_price = min(lowest_price, low)
                lowest_price_reached = min(lowest_price_reached, low)

            # لو في data error، skip المقارنة دي خالص — الصفقة تفضل PENDING
            if data_error_flag:
                continue

            days_elapsed = i + 1

            # For BUY signals: target is above, stop is below
            if is_buy:
                # B1/B2/B5 FIX: إغلاق على سعر التفعيل (trigger price)، مش close.
                # لما الهدف/الوقف يُلمس خلال اليوم، نقفل على سعر التفعيل:
                #   - TARGET_HIT → exit عند target_price (أمر limit)
                #   - STOPPED    → exit عند stop_loss   (أمر stop)
                # ده بـ يمنع: (B1) STOPPED بـ return≥0 لو close>entry بعد ضربة الوقف،
                # (B2) TARGET_HIT بـ return=0% لو close≈entry بعد لمس الهدف،
                # (B5) اتجاه SELL صحيح (الربح لما السعر ينزل).
                if target_price > 0 and high >= target_price:
                    _exit_px = target_price
                    actual_return = ((_exit_px - entry_price) / entry_price * 100) if entry_price > 0 else 0
                    return self._mark_closed(pred_id, ticker, 'TARGET_HIT', actual_return,
                                            highest_price, lowest_price, days_elapsed, day.get('date', ''),
                                            exit_type='target_hit', exit_close_price=_exit_px,
                                            highest_price_reached=highest_price_reached,
                                            lowest_price_reached=lowest_price_reached)
                # ── CLOSED CAMP FIX 1 (2026-08-28): BE-stop-after-+3%-MFE ──
                # BEFORE checking stop_loss, check if MFE reached +3%.
                # If yes, replace stop_loss with breakeven (entry_price).
                # This rescues 33% of trades that went up then crashed back.
                _effective_stop = stop_loss
                if entry_price > 0 and highest_price_reached > 0:
                    _mfe_pct = (highest_price_reached - entry_price) / entry_price * 100
                    if _mfe_pct >= 3.0:
                        _effective_stop = entry_price  # move to breakeven!

                # ── Task part4-stop-loss: تأجيل stop لو قرب ينهي التصحيح ──
                # المالك: "لو السهم قرب على أنهاء التصحيح مش هانوقف خسارة لانة لسة هايزيد"
                # تحقق قبل stop_loss لـ BUY positions — لو السهم بدأ يتعافى، نأجل ليوم واحد.
                # (شرط is_buy — SELL positions ما بـ نـ deferهاش لأن التعافي ضدنا)
                try:
                    _mr_gain_pct = (close - entry_price) / entry_price * 100 if entry_price > 0 else 0
                    if self._should_defer_stop_for_correction_end(
                        pred_id, ticker, day.get('date', ''), close,
                        float(day.get('volume', 0) or 0), _mr_gain_pct
                    ):
                        continue  # skip stop-loss check for today — defer to next day
                except Exception as _defer_e:
                    logger.warning(
                        f"[DailyCloser] #{pred_id} {ticker} {day.get('date','')}: defer-check failed: {_defer_e}"
                    )

                if _effective_stop > 0 and low <= _effective_stop:
                    _exit_px = _effective_stop
                    actual_return = ((_exit_px - entry_price) / entry_price * 100) if entry_price > 0 else 0
                    _exit_status = 'CLOSED' if _effective_stop == entry_price else 'STOPPED'
                    _exit_type = 'breakeven_mfe3' if _effective_stop == entry_price else 'stop_loss'
                    return self._mark_closed(pred_id, ticker, _exit_status, actual_return,
                                            highest_price, lowest_price, days_elapsed, day.get('date', ''),
                                            exit_type=_exit_type, exit_close_price=_exit_px,
                                            highest_price_reached=highest_price_reached,
                                            lowest_price_reached=lowest_price_reached)
            else:  # SELL signals: target is below, stop is above
                if target_price > 0 and low <= target_price:
                    _exit_px = target_price
                    actual_return = ((entry_price - _exit_px) / entry_price * 100) if entry_price > 0 else 0
                    return self._mark_closed(pred_id, ticker, 'TARGET_HIT', actual_return,
                                            highest_price, lowest_price, days_elapsed, day.get('date', ''),
                                            exit_type='target_hit', exit_close_price=_exit_px,
                                            highest_price_reached=highest_price_reached,
                                            lowest_price_reached=lowest_price_reached)
                if stop_loss > 0 and high >= stop_loss:
                    _exit_px = stop_loss
                    actual_return = ((entry_price - _exit_px) / entry_price * 100) if entry_price > 0 else 0
                    return self._mark_closed(pred_id, ticker, 'STOPPED', actual_return,
                                            highest_price, lowest_price, days_elapsed, day.get('date', ''),
                                            exit_type='stop_loss', exit_close_price=_exit_px,
                                            highest_price_reached=highest_price_reached,
                                            lowest_price_reached=lowest_price_reached)

            # Check expiry
            # ULTRA-FIX (2026-08-11): SELL signals تحتاج معادلة عكسية —
            # قبل ده كان بـ يحسب SELL expiry بـ معادلة BUY → ربح بدل خسارة والعكس.
            # ده سبب -204% losses للـ GGCC (SELL لكن اتحسب كـ BUY).
            if days_elapsed >= max_holding_days:
                if is_buy:
                    actual_return = ((close - entry_price) / entry_price * 100) if entry_price > 0 else 0
                else:  # SELL — profit when price drops
                    actual_return = ((entry_price - close) / entry_price * 100) if entry_price > 0 else 0
                # ULTRA-FIX: Cap expiry loss at -20% (realistic stop-loss ceiling)
                if actual_return < -20.0:
                    actual_return = -20.0
                return self._mark_closed(pred_id, ticker, 'EXPIRED', actual_return,
                                        highest_price, lowest_price, days_elapsed, day.get('date', ''),
                                        exit_type='expired', exit_close_price=close,
                                        highest_price_reached=highest_price_reached,
                                        lowest_price_reached=lowest_price_reached)

        # ── Live-price fallback (Closed-Loop A3) ──────────────────────────
        # لو الـ daily bars ما تغطّيش الفترة بعد يوم التوقع (مثلاً آخر bar هو
        # يوم التوقع نفسه، أو الـ bars كلها من الماضي)، نتحقّق من السعر الحي
        # الحالي (نفس مصدر الشارت) عشان نقفل لو الهدف/الوقف اتلمس.
        # ده نفس منطق الـ "no price history" fallback، لكن بيتفعّل كمان لو
        # الـ history موجودة بس مش كافية لتغطية الأيام اللي بعد التوقع.
        try:
            _live_price = self._get_current_price_stocks(ticker)
            if _live_price > 0 and entry_price > 0:
                # ── DATA-POLLUTION GUARD (CRITICAL FIX 2026-08-15) ──────────
                # الـ live-price fallback كان بـ يستخدم stocks.current_price
                # من غير ما يتأكد إنه منطقى relative لـ entry_price. ده خلا
                # الكلاوزر يقفل 3 توقعات كـ TARGET_HIT كاذب بنسبة 94.96% لما
                # stocks.current_price رجعت قيم ملوّثة (GETO=15.0 بدل 297،
                # PTCC=19.0 بدل 244). دلوقتي بنطبّق نفس thresholds بتاعة
                # DataClean (entry × 0.2 و entry × 5.0) على الـ live price كمان.
                DATA_CLEAN_MIN_MULT = 0.2   # live < entry × 0.2 → ملوّث
                DATA_CLEAN_MAX_MULT = 5.0   # live > entry × 5.0 → ملوّث
                if _live_price < entry_price * DATA_CLEAN_MIN_MULT or _live_price > entry_price * DATA_CLEAN_MAX_MULT:
                    logger.warning(
                        f"[DataClean-Live] {ticker}: live={_live_price} vs entry={entry_price} "
                        f"→ DATA POLLUTION (outside [{DATA_CLEAN_MIN_MULT}×, {DATA_CLEAN_MAX_MULT}×] range). "
                        f"Skipping live-price fallback — prediction stays PENDING."
                    )
                    # لا تقفل على أساس سعر ملوّث — اترك التوقع معلّق لحد ما
                    # الـ price_history يكتمل بـ bars حقيقية.
                else:
                    # احسب days_elapsed من تاريخ التوقع لـ اليوم
                    try:
                        _pred_dt = datetime.strptime(start_date, '%Y-%m-%d')
                        _live_days = max(1, (datetime.now() - _pred_dt).days)
                    except Exception:
                        _live_days = 1

                    if _live_price > highest_price_reached and is_buy:
                        highest_price_reached = _live_price
                    if _live_price < lowest_price_reached or lowest_price_reached == entry_price:
                        if _live_price < lowest_price_reached:
                            lowest_price_reached = _live_price

                    if is_buy:
                        if target_price > 0 and _live_price >= target_price:
                            _ret = ((_live_price - entry_price) / entry_price * 100)
                            logger.info(f"[DailyCloser] {ticker} BUY live-price target hit: live={_live_price} >= target={target_price}")
                            return self._mark_closed(pred_id, ticker, 'TARGET_HIT', _ret,
                                                    highest_price, lowest_price, _live_days,
                                                    datetime.now().strftime('%Y-%m-%d'),
                                                    exit_type='target_hit', exit_close_price=_live_price,
                                                    highest_price_reached=highest_price_reached,
                                                    lowest_price_reached=lowest_price_reached)
                        if stop_loss > 0 and _live_price <= stop_loss:
                            _ret = ((_live_price - entry_price) / entry_price * 100)
                            logger.info(f"[DailyCloser] {ticker} BUY live-price stop hit: live={_live_price} <= stop={stop_loss}")
                            return self._mark_closed(pred_id, ticker, 'STOPPED', _ret,
                                                    highest_price, lowest_price, _live_days,
                                                    datetime.now().strftime('%Y-%m-%d'),
                                                    exit_type='stop_loss', exit_close_price=_live_price,
                                                    highest_price_reached=highest_price_reached,
                                                    lowest_price_reached=lowest_price_reached)
                    else:  # SELL
                        if target_price > 0 and _live_price <= target_price:
                            _ret = ((entry_price - _live_price) / entry_price * 100)
                            logger.info(f"[DailyCloser] {ticker} SELL live-price target hit: live={_live_price} <= target={target_price}")
                            return self._mark_closed(pred_id, ticker, 'TARGET_HIT', _ret,
                                                    highest_price, lowest_price, _live_days,
                                                    datetime.now().strftime('%Y-%m-%d'),
                                                    exit_type='target_hit', exit_close_price=_live_price,
                                                    highest_price_reached=highest_price_reached,
                                                    lowest_price_reached=lowest_price_reached)
                        if stop_loss > 0 and _live_price >= stop_loss:
                            _ret = ((entry_price - _live_price) / entry_price * 100)
                            logger.info(f"[DailyCloser] {ticker} SELL live-price stop hit: live={_live_price} >= stop={stop_loss}")
                            return self._mark_closed(pred_id, ticker, 'STOPPED', _ret,
                                                    highest_price, lowest_price, _live_days,
                                                    datetime.now().strftime('%Y-%m-%d'),
                                                    exit_type='stop_loss', exit_close_price=_live_price,
                                                    highest_price_reached=highest_price_reached,
                                                    lowest_price_reached=lowest_price_reached)

                    #_expiry check via live price
                    if _live_days >= max_holding_days:
                        _ret = ((_live_price - entry_price) / entry_price * 100) if is_buy else ((entry_price - _live_price) / entry_price * 100)
                        return self._mark_closed(pred_id, ticker, 'EXPIRED', _ret,
                                                highest_price, lowest_price, _live_days,
                                                datetime.now().strftime('%Y-%m-%d'),
                                                exit_type='expired', exit_close_price=_live_price,
                                                highest_price_reached=highest_price_reached,
                                                lowest_price_reached=lowest_price_reached)
        except Exception as _lp_err:
            logger.warning(f"[DailyCloser] live-price fallback failed for {ticker}: {_lp_err}")

        # ── CLOSED-LOOP LOG: ليه الصف فضل PENDING ──
        # قبل كده كان silent return None → المستخدم يشوف "closed=0" بدون سبب.
        # دلوقتي بنوضّح: لو الـ target/stop مش اتلمس و الـ days < max، الصف
        # بـ يفضل PENDING شرعي. لو الـ live price رجع 0، دي مشكلة مصدر سعر.
        try:
            _live_for_log = self._get_current_price_stocks(ticker)
            _pred_dt_log = datetime.strptime(start_date, '%Y-%m-%d')
            _days_log = max(0, (datetime.now() - _pred_dt_log).days)
        except Exception:
            _live_for_log = 0.0
            _days_log = 0
        logger.info(
            f"[DailyCloser] #{pred_id} {ticker} STAYS PENDING — "
            f"live={_live_for_log} target={target_price} stop={stop_loss} "
            f"days_elapsed={_days_log} max_days={max_holding_days} "
            f"(target/stop not touched, still within holding window)"
        )

        return None  # Still pending — not enough data yet

    def _mark_closed(self, pred_id, ticker, status, actual_return, highest, lowest, days, close_date,
                     exit_type='', highest_price_reached=0.0, lowest_price_reached=0.0, holding_days=0, exit_close_price=0.0):
        """Mark a prediction as closed in the database.

        Args:
            exit_close_price: سعر الإغلاق الفعلي يوم الحدث (REALITY-CHECK-023).
                لو 0، بنستخدم highest_price_reached كـ fallback.
        """
        # Determine exit_type from status if not explicitly provided
        if not exit_type:
            exit_type_map = {
                'TARGET_HIT': 'target_hit',
                'STOPPED': 'stop_loss',
                'EXPIRED': 'expired',
            }
            exit_type = exit_type_map.get(status, status.lower())

        # Use highest_price_reached if provided, otherwise fall back to highest
        if highest_price_reached <= 0:
            highest_price_reached = highest

        # Use lowest_price_reached if provided, otherwise fall back to lowest
        if lowest_price_reached <= 0:
            lowest_price_reached = lowest if (lowest != float('inf') and lowest > 0) else 0.0

        if holding_days <= 0:
            holding_days = days

        # ──────────────────────────────────────────────────────────────────────
        # CRITICAL-DIRECTIVE (2026-08-16): Hard Loss Ceiling + Split Guard
        # ──────────────────────────────────────────────────────────────────────
        # المالك: "محرك الإغلاق أعمى مش فاهم التجزئة. ANFI نزل من 287 لـ 97
        # بسبب تجزئة السهم؛ محرك daily_closer ميعرفش يعني إيه تجزئة، فقام حاسب
        # (97 - 287) / 287 = -65.99%! في حين إن الصفقة كان ليها وقف عند 257،
        # فمستحيل في أي منطق مالي تسجل خسارة أكتر من الوقف!"
        #
        # الطبقتان الإلزاميتان (قبل الكتابة في DB):
        # 1) SPLIT GUARD: لو actual_return < -35% من entry_price → تجزئة سهم →
        #    استبعاد الصفقة من P&L (actual_return=0, exit_type='split_excluded',
        #    data_quality='split_excluded').
        # 2) HARD LOSS CEILING: لو actual_return < -7% → cap عند -7%.
        #    ممنوع منعاً باتاً تسجيل -60% أو -90% في actual_return.
        # ──────────────────────────────────────────────────────────────────────
        _split_excluded = False
        _capped_loss = False
        try:
            _ep_conn = self._conn(self.predictions_db)
            _ep_cur = _ep_conn.cursor()
            _ep_cur.execute("SELECT entry_price, stop_loss FROM predictions WHERE id = ?", (pred_id,))
            _ep_row = _ep_cur.fetchone()
            _ep_conn.close()
            _entry_price_db = float(_ep_row[0]) if _ep_row and _ep_row[0] else 0.0
            _stop_loss_db = float(_ep_row[1]) if _ep_row and len(_ep_row) > 1 and _ep_row[1] else 0.0

            if _entry_price_db > 0:
                # ── SPLIT GUARD: drop > 35% from entry without progressive stop ──
                if actual_return < -_SPLIT_DROP_THRESHOLD_PCT:
                    _split_excluded = True
                    _original_return = actual_return
                    actual_return = 0.0  # استبعاد من P&L
                    exit_type = 'split_excluded'
                    logger.warning(
                        f"[SPLIT-GUARD] #{pred_id} {ticker}: actual_return={_original_return:.2f}% "
                        f"< -{_SPLIT_DROP_THRESHOLD_PCT}% threshold → SPLIT EXCLUDED "
                        f"(entry={_entry_price_db}, stop={_stop_loss_db}) — not counted in P&L"
                    )
                # ── HARD LOSS CEILING: cap actual_return at -7% ──
                elif actual_return < -_HARD_LOSS_CEILING_PCT:
                    _capped_loss = True
                    _original_return = actual_return
                    actual_return = -_HARD_LOSS_CEILING_PCT  # cap at -7%
                    logger.warning(
                        f"[HARD-CEILING] #{pred_id} {ticker}: actual_return={_original_return:.2f}% "
                        f"< -{_HARD_LOSS_CEILING_PCT}% ceiling → CAPPED to -{_HARD_LOSS_CEILING_PCT}% "
                        f"(entry={_entry_price_db}, stop={_stop_loss_db})"
                    )
        except Exception as _guard_err:
            logger.warning(
                f"[GUARD] #{pred_id} {ticker}: split/ceiling guard lookup failed: {_guard_err} — "
                f"proceeding with original actual_return={actual_return:.2f}%"
            )
        # ──────────────────────────────────────────────────────────────────────

        try:
            conn = self._conn(self.predictions_db)
            cursor = conn.cursor()
            # FIX (July 2026): use actual column names from predictions table.
            # Old code used status/days_to_close/closed_at/highest_price/lowest_price
            # which don't exist. Use: outcome_date, actual_exit_price, actual_return,
            # hit_target, hit_stop, is_correct, holding_days, exit_type, highest_price_reached,
            # lowest_price_reached (P6-PREDICTIONS).
            #
            # REALITY-CHECK-023 (إصلاح كذبة exit_price):
            # الكود القديم كان بيكتب actual_return (نسبة مئوية) في حقل exit_price!
            # ده غلط — exit_price مفروض يكون سعر الإغلاق يوم الحدث.
            # الحل: exit_price = سعر الإغلاق الفعلي (close_price)،
            # actual_return = النسبة المئوية للربح/الخسارة.
            # ============================================================
            # PHASE-A1 (أغسطس 2026): إصلاح bug حرج — العمود الفعلي في DB هو
            # `actual_exit_price` وليس `exit_price`. الكود القديم كان بيكتب `exit_price`
            # اللي مش موجود → silent exception → 3227+ توقع عالق في status='active'
            # للأبد. ده كان بيسكّت التتبع والتعلم كله.
            # ============================================================
            # الأولوية: exit_close_price > highest_price_reached > highest > NULL
            _exit_price_value = float(exit_close_price or highest_price_reached or highest or 0)
            if _exit_price_value <= 0:
                # لو مفيش سعر متاح خالص → NULL (مش نكتب نسبة في حقل سعر)
                _exit_price_value = None

            cursor.execute("""
                UPDATE predictions
                SET outcome_date = ?,
                    actual_exit_price = ?,
                    actual_return = ?,
                    hit_target = ?,
                    hit_stop = ?,
                    is_correct = ?,
                    holding_days = ?,
                    exit_type = ?,
                    highest_price_reached = ?,
                    lowest_price_reached = ?,
                    status = ?
                WHERE id = ?
            """, (
                close_date,
                _exit_price_value,  # REALITY-CHECK-023: سعر فعلي (مش نسبة)
                round(actual_return, 2),
                1 if status == 'TARGET_HIT' else 0,
                1 if status == 'STOPPED' else 0,
                # B1 FIX: is_correct من exit_type (مش من علامة العائد بس).
                # stop_loss = خسارة دايماً (ممنوع نسمّي ضربة وقف "win" بالغلط).
                # target_hit = نجاح دايماً. expired/trailing = بعلامة العائد.
                (1 if exit_type == 'target_hit' else (0 if exit_type == 'stop_loss' else (1 if actual_return > 0 else 0))),
                days,
                exit_type,
                round(highest_price_reached, 2),
                round(lowest_price_reached, 2) if lowest_price_reached and lowest_price_reached > 0 else None,
                status,
                pred_id
            ))
            conn.commit()
            conn.close()
            logger.info(f"Closed prediction #{pred_id} ({ticker}): {status}/{exit_type}, return={actual_return:.2f}%, days={days}")

            # ── TELEGRAM NOTIFIER (2026-08-30) ──
            # المالك: "لو توقع جاب الهدف نعمل حفلة ونبعت على التليجرام"
            try:
                from telegram.telegram_notifier import TelegramNotifier
                _notifier = TelegramNotifier()
                if _notifier.enabled:
                    if status == 'TARGET_HIT' and actual_return > 0:
                        _notifier.notify_target_hit(
                            ticker=ticker,
                            entry=float(_entry_price_db),
                            target=exit_close_price or highest_price_reached,
                            return_pct=actual_return,
                            target_num=1 if exit_type in ('target_hit', 'trailing_profit') else 2,
                        )
            except Exception:
                pass  # safe-by-design

            # ── CRITICAL-DIRECTIVE: write data_quality for SPLIT_EXCLUDED / LOSS_CAPPED ──
            # لو الـ guard اللي فوق عمل split_excluded أو cap للخسارة → نكتب data_quality
            # علشان الـ P&L queries + dashboard يقدروا يـ exclude/handle الصفوف دي.
            # الأسبقية: split_excluded > loss_capped > toxic (لو كذا conditions).
            if _split_excluded or _capped_loss:
                try:
                    _gconn = self._conn(self.predictions_db)
                    _gcur = _gconn.cursor()
                    _gcur.execute("PRAGMA table_info(predictions)")
                    _has_dq_g = any(row[1] == 'data_quality' for row in _gcur.fetchall())
                    if _has_dq_g:
                        _dq_value = 'split_excluded' if _split_excluded else 'loss_capped'
                        _gcur.execute(
                            "UPDATE predictions SET data_quality = ? WHERE id = ?",
                            (_dq_value, pred_id)
                        )
                        _gconn.commit()
                    _gconn.close()
                except Exception as _gq_err:
                    logger.warning(f"[GUARD-WRITE] #{pred_id} {ticker}: failed to set data_quality: {_gq_err}")

            # ── DATA-QUALITY: علم الـ closes المشبوهة كـ toxic ──────────────
            # لو |actual_return| > 50% عند الإغلاق → ده رقم مش طبيعي (split/feed
            # artifact أو bug في entry/exit). اقفل الصف لكن علّمه toxic + log
            # [CLOSE_SUSPECT] عشان الـ purge والـ reports يقدروا يـ excludeه.
            # مـ بـ نكتبش data_quality='clean' هنا — الـ purge script بـ يعمل
            # التصنيف الكامل. الـ closer بـ يعلّم بس المشبوه.
            # CRITICAL-DIRECTIVE: تخطّى الـ toxic marking لو الـ guard اللي فوق
            # شغال (split_excluded/loss_capped بـ يتكتب فوق).
            elif abs(actual_return) > 50.0:
                try:
                    _tconn = self._conn(self.predictions_db)
                    _tcur = _tconn.cursor()
                    # تحقّق إن العمود موجود (الـ purge بـ يضيفه)
                    _tcur.execute("PRAGMA table_info(predictions)")
                    _has_dq = any(row[1] == 'data_quality' for row in _tcur.fetchall())
                    # CRITICAL FIX 2026-08-15: entry_price مش معرّف فى scope ده.
                    # كنا بنـ reference entry_price فى الـ f-string تحت، بس ده
                    # بـ يـ raise NameError: name 'entry_price' is not defined
                    # (شوف log 2026-08-15T23:35). الحل: نـ fetch entry_price
                    # من نفس الـ connection المفتوح.
                    _toxic_entry_price = 0.0
                    try:
                        _toxic_entry_price = float(_tcur.execute(
                            "SELECT entry_price FROM predictions WHERE id = ?",
                            (pred_id,)
                        ).fetchone()[0] or 0)
                    except Exception:
                        pass
                    if _has_dq:
                        _tcur.execute(
                            "UPDATE predictions SET data_quality = 'toxic' WHERE id = ?",
                            (pred_id,)
                        )
                        _tconn.commit()
                    _tconn.close()
                    logger.warning(
                        f"[CLOSE_SUSPECT] #{pred_id} {ticker}: |return|={abs(actual_return):.2f}% > 50% "
                        f"→ marked toxic (entry={_toxic_entry_price:.4f} exit={_exit_price_value}) "
                        f"possible split/feed-artifact"
                    )
                except Exception as _tq_err:
                    logger.warning(f"[CLOSE_SUSPECT] #{pred_id} {ticker}: failed to mark toxic: {_tq_err}")

            # ── B1 (Closed-Loop): سجّل درس من الإغلاق ──────────────────────
            # كل إغلاق بـ يولّد درس (lesson_code) يقرأه المايسترو في التحليل
            # الجاي → ده اللي بـ يقفل الـ loop. بنقرأ الـ prediction row من
            # الـ DB عشان نحصل على persona/atr/regime/score (متوفرة في كل المسارات).
            if _LESSON_STORE_AVAILABLE:
                try:
                    _rconn = self._conn(self.predictions_db)
                    _rcur = _rconn.cursor()
                    _rcur.execute(
                        'SELECT persona, entry_price, target_price, stop_loss, '
                        'atr_at_entry, score, signal FROM predictions WHERE id = ?',
                        (pred_id,)
                    )
                    _prow = _rcur.fetchone()
                    _rconn.close()
                    if _prow:
                        record_lesson_from_close(
                            ticker=ticker,
                            persona=_prow['persona'] or 'balanced',
                            exit_type=exit_type or status.lower(),
                            actual_return=actual_return,
                            holding_days=days,
                            entry_price=float(_prow['entry_price'] or 0),
                            stop_loss=float(_prow['stop_loss'] or 0),
                            target_price=float(_prow['target_price'] or 0),
                            atr_at_entry=float(_prow['atr_at_entry'] or 0),
                            regime='',  # predictions table لا تخزّن regime
                            score=float(_prow['score'] or 0),
                        )
                except Exception as _le:
                    logger.warning(f"[DailyCloser] B1 lesson record failed for #{pred_id}: {_le}")

                # 🔥 VERIFY-RL: Positive reinforcement — سجّل درس من الصفقات الجيدة.
                # النظير الإيجابي لـ record_lesson_from_close: لو الصفقة رابحة بـ
                # pattern واضح (EARLY_BREAKOUT/TREND_RIDE/VOLUME_CONFIRMED/GRIND_WIN)
                # → سجّله عشان المايسترو يكرره (raise target, hold-through T1).
                # بـ تتـ call بس لو الصفقة رابحة (return > 0)؛ بـ return None لو
                # ما تطابقش مع pattern.
                if actual_return > 0:
                    try:
                        import sys as _win_sys
                        _vps = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                        if _vps not in _win_sys.path:
                            _win_sys.path.insert(0, _vps)
                        from utils.win_lesson_store import record_win_lesson_from_close
                        # اقرأ highest_price_reached من الـ prediction لو متاح
                        _hpr = float(_prow['highest_price_reached'] or 0) if _prow else 0.0
                        record_win_lesson_from_close(
                            ticker=ticker,
                            persona=_prow['persona'] if _prow else 'balanced',
                            exit_type=exit_type or status.lower(),
                            actual_return=actual_return,
                            holding_days=days,
                            entry_price=float(_prow['entry_price'] or 0) if _prow else entry_price,
                            stop_loss=float(_prow['stop_loss'] or 0) if _prow else 0.0,
                            target_price=float(_prow['target_price'] or 0) if _prow else 0.0,
                            highest_price_reached=_hpr,
                            volume_ratio_at_close=0.0,  # مفيش volume data في الـ _mark_closed
                            atr_at_entry=float(_prow['atr_at_entry'] or 0) if _prow else 0.0,
                        )
                    except Exception as _win_le:
                        logger.debug(f"[DailyCloser] win-lesson record (optional) skipped for #{pred_id}: {_win_le}")
        except Exception as e:
            logger.error(f"Error closing prediction #{pred_id}: {e}")

        return CloseResult(
            prediction_id=pred_id, ticker=ticker, old_status='PENDING', new_status=status,
            actual_return=actual_return, highest_price=highest, lowest_price=lowest,
            days_to_close=days, close_date=close_date,
            exit_type=exit_type, highest_price_reached=highest_price_reached,
            holding_days=holding_days,
        )

    def _mark_expired(self, pred_id, ticker, entry_price, days_elapsed):
        """Mark a prediction as expired (no price data available for max+ days).

        RL-FIX-9 (BUG #4): بنمرّر entry_price كـ highest/lowest بدل 0.0.
        ده علشان الـ UI ما يعرضش High==Low==0 (اللي بـ fallback لـ entry لواحده
        بس بشكل غير متسق). الآن High==Low==entry للـ EXPIRED rows — منطقي
        لأنه مفيش سعر اتسجل بعد الدخول.
        """
        _safe_entry = float(entry_price or 0)
        return self._mark_closed(pred_id, ticker, 'EXPIRED', 0.0,
                                _safe_entry, _safe_entry, days_elapsed,
                                datetime.now().strftime('%Y-%m-%d'),
                                exit_type='expired',
                                highest_price_reached=_safe_entry,
                                lowest_price_reached=_safe_entry)

    def run(self) -> Dict:
        """Run the daily closer — close all pending predictions"""
        start_time = datetime.now()
        logger.info(f"[DailyCloser] Starting at {start_time.isoformat()}")

        pending = self.get_pending_predictions()
        logger.info(f"[DailyCloser] Found {len(pending)} pending predictions")

        # ── PRODUCTION-WIRING: Circuit Breaker ──
        # لو فيه 3 خسائر متتالية → وقف الإغلاق المؤقت للوقاية
        _cb = None
        try:
            from utils.circuit_breaker import CircuitBreaker
            _cb = CircuitBreaker(consecutive_losses_limit=3, cooldown_days=3, mode='block')
        except Exception:
            _cb = None

        results = {'TARGET_HIT': 0, 'STOPPED': 0, 'EXPIRED': 0, 'CLOSED': 0, 'STILL_PENDING': 0, 'ERROR': 0}
        close_results = []
        _consecutive_losses = 0

        for pred in pending:
            try:
                # Circuit breaker: لو 3 خسائر متتالية → skip
                if _cb and _cb.is_blocked(pred.get('prediction_date', '')):
                    logger.info(f"[CB-BLOCK] Skipping {pred.get('ticker')} — circuit breaker active")
                    results['STILL_PENDING'] += 1
                    continue

                result = self.close_prediction(pred)
                if result:
                    results[result.new_status] += 1
                    close_results.append(result)

                    # تحديث circuit breaker
                    if _cb:
                        _ret = float(result.actual_return or 0)
                        _cb.record_trade(pred.get('prediction_date', ''), _ret)
                        if _ret <= 0:
                            _consecutive_losses += 1
                        else:
                            _consecutive_losses = 0
                    # Trigger immediate learning after each close
                    # — تعلّم فوري بعد كل إغلاق: النظام يتحسّن من كل نتيجة
                    try:
                        from jobs.learning_engine import trigger_immediate_learning
                        current_regime = str(pred.get('regime', 'range') or 'range')
                        trigger_immediate_learning(ticker=pred.get('ticker', ''), regime=current_regime)
                    except Exception as le:
                        logger.warning(f"Failed to trigger immediate learning for {pred.get('ticker')}: {le}")

                    # REALITY-CHECK-023: تعلّم من الفشل — لو التوقع ضرب SL،
                    # نسجّل الدرس في learned_lessons عشان العقل يتعلم منه
                    if result.new_status == 'STOPPED':
                        try:
                            from analyzers.prediction_tracker import PredictionTracker
                            tracker = PredictionTracker(self.predictions_db)
                            learn_result = tracker.learn_from_failure(
                                prediction_id=pred.get('id'),
                                failure_reason=f"ضرب وقف الخسارة بعد {result.days_to_close} يوم — {result.exit_type}"
                            )
                            logger.info(f"[DailyCloser] Learned from failure #{pred.get('id')}: {learn_result.get('pattern')}")
                        except Exception as le_err:
                            logger.warning(f"Failed to learn from failure #{pred.get('id')}: {le_err}")
                else:
                    results['STILL_PENDING'] += 1
            except Exception as e:
                logger.error(f"Error processing prediction {pred.get('id')}: {e}")
                results['ERROR'] += 1

        elapsed = (datetime.now() - start_time).total_seconds()
        summary = {
            'total_pending': len(pending),
            'closed': results,
            'elapsed_seconds': round(elapsed, 1),
            'timestamp': start_time.isoformat(),
            # P0-v18: price-source stats — عشان المالك يشوف ليه توقعات بـ تفضل pending
            'price_source_stats': dict(self._ph_stats),
        }

        # ── B4 (Closed-Loop): الفرص الضائعة → دروس ──────────────────────
        # بعد قفل التوقعات، امسح السوق للأسهم اللي تحرّكت بقوة بدون توصية شراء
        # → سجّلها MISSED_BREAKOUT عشان المايسترو يتعلم يلتقطها المرة الجاية.
        try:
            from utils.lesson_store import detect_and_record_missed_opportunities
            missed = detect_and_record_missed_opportunities(days=1, change_threshold=8.0)
            if missed:
                summary['missed_opportunities_recorded'] = missed
                logger.info(f"[DailyCloser] B4 recorded {missed} missed-breakout lessons")
        except Exception as _me:
            logger.warning(f"[DailyCloser] B4 missed-opportunities scan failed: {_me}")

        logger.info(f"[DailyCloser] Done: {summary}")
        return summary


def main():
    """Run the daily closer standalone.

    الاستخدام من سطر الأوامر (على نفس آلة pm2):
        cd ~/my_apps/GLMinvestment/vps-service
        python3 -m jobs.daily_closer
        # أو:
        python3 jobs/daily_closer.py

    بيفتح predictions.db من db/predictions.db (نفس اللي بـ يستخدمه pm2).
    بـ يطبع: عدد PENDING، عدد المقفل (TARGET_HIT/STOPPED/EXPIRED)،
    عدد اللي فضل PENDING، وعدد الأخطاء.

    P4-CRON (v3.70.0): لما بـ يشتغل من cron، الـ output بيروح لـ logs/closer.log.
    أضفنا banner [CRON_CLOSER] واضح في البداية والنهاية عشان المالك يقدر يتحقق
    إن الـ log بـ يزيد من غير تشغيل يدوي:
        tail -f logs/closer.log | grep CRON_CLOSER
    """
    import sys, os
    from datetime import datetime as _dt
    # لو اشتُغل من غير cwd صحيح، حدّد الـ path
    _here = os.path.dirname(os.path.abspath(__file__))
    _vps = os.path.dirname(_here)
    _repo = os.path.dirname(_vps)
    if _vps not in sys.path:
        sys.path.insert(0, _vps)

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    # P4-CRON: banner واضح عشان grep يلاقيه في logs/closer.log
    _run_ts = _dt.now().isoformat()
    print(f"\n{'='*60}")
    print(f"[CRON_CLOSER] START ts={_run_ts} pid={os.getpid()}")
    print(f"[CRON_CLOSER] CWD={os.getcwd()}  predictions_db=db/predictions.db")
    print(f"{'='*60}", flush=True)
    closer = DailyCloser()
    result = closer.run()
    print(f"\n{'='*60}")
    print(f"📊 Daily Closer Results:")
    print(f"  Total Pending (examined): {result['total_pending']}")
    print(f"  Target Hit:    {result['closed']['TARGET_HIT']}")
    print(f"  Stopped:       {result['closed']['STOPPED']}")
    print(f"  Expired:       {result['closed']['EXPIRED']}")
    print(f"  Still Pending: {result['closed']['STILL_PENDING']}")
    print(f"  Errors:        {result['closed']['ERROR']}")
    print(f"  Elapsed:       {result['elapsed_seconds']}s")
    # P0-v18: price-source stats — ليه التوقعات بـ تفضل pending؟
    _ps = result.get('price_source_stats', {})
    if _ps:
        print(f"  ── Price Source (لماذا تبقى معلقة؟) ──")
        print(f"    price_history.db:   {_ps.get('found_price_history',0)}")
        print(f"    vps_real/price_h:   {_ps.get('found_vps_real',0)}")
        print(f"    data_engine (EGKSCO):{_ps.get('found_data_engine',0)}")
        print(f"    stocks.db:          {_ps.get('found_stocks_db',0)}")
        print(f"    ⚠ لا أسعار لأى DB:  {_ps.get('not_found_anywhere',0)}")
        if _ps.get('not_found_anywhere',0) > 0:
            print(f"    → سبب الإغلاق=0: الأسعار مش موجودة. شغّل daily_price_updater")
    print(f"{'='*60}")
    # اطبع حالة DB بعد التشغيل عشان المستخدم يشوف closed/lessons
    try:
        import sqlite3 as _s3
        _db = os.path.join(_repo, 'db', 'predictions.db')
        _c = _s3.connect(_db)
        _closed = _c.execute('SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL').fetchone()[0]
        _lessons = _c.execute('SELECT COUNT(*) FROM learned_lessons').fetchone()[0]
        _c.close()
        print(f"  DB now: closed={_closed}  lessons={_lessons}")
        print(f"{'='*60}")
    except Exception as _e:
        print(f"  (could not read DB state: {_e})")

    # P4-CRON: END banner عشان المالك يتأكد إن الـ run اكتمل (مش crash في النص)
    _end_ts = _dt.now().isoformat()
    _dur = result.get('elapsed_seconds', 0)
    print(f"[CRON_CLOSER] END ts={_end_ts} duration={_dur}s "
          f"closed={sum(v for k,v in result['closed'].items() if k!='STILL_PENDING')} "
          f"still_pending={result['closed']['STILL_PENDING']}", flush=True)


if __name__ == '__main__':
    main()

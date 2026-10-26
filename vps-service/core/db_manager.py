"""
db_manager.py — البوابة المركزية الموحّدة للوصول لكل قواعد البيانات
=====================================================================
(Phase 8 — Central Data Access Layer)

المشكلة اللي بتحلها:
    كان فيه ~100+ مكان في الكود بيفتح `sqlite3.connect()` بإيده، ده بيسبّب:
      - Database Locking (اتصالات متزامنة بدون WAL/busy_timeout)
      - I/O بطيء (مفيش connection reuse)
      - تكرار مسارات الـ DB في كل ملف (DRY violation)
      - صعوبة الصيانة (تغيير مسار DB = تعديل 100 ملف)

الحل:
    دي البوابة الوحيدة. أي محرك عايز داتا ينادي `DBManager`.
    كل الاتصالات بتشتغل بـ:
      - WAL mode (journal_mode=WAL)
      - busy_timeout=30000 (30 ثانية)
      - immutable=1 للقراءة فقط (bypass WAL corruption)
      - synchronous=NORMAL (توازن سرعة/أمان)
      - wal_autocheckpoint=1000

الاستخدام:
    from core.db_manager import db_manager

    # قراءة (readonly, immutable fallback)
    rows = db_manager.query('stocks', "SELECT ticker, name FROM stocks WHERE is_active=1")

    # كتابة (WAL + busy_timeout + auto-checkpoint)
    db_manager.execute('predictions',
        "INSERT INTO predictions (ticker, signal) VALUES (?, ?)",
        ('COMI', 'BUY'))

    # connection context (للـ transactions المعقدة)
    with db_manager.connection('stocks', writable=True) as conn:
        conn.execute("UPDATE stocks SET current_price = ? WHERE ticker = ?", (price, ticker))
        conn.commit()

الـ 8 قواعد المعتمدة:
    stocks, predictions, price_history, data_engine, intraday,
    auth, crypto, crypto_learning

مبدأ التصميم:
    - مفيش ملفات جديدة تاني — دي البوابة الوحيدة.
    - backward compatible: الـ DatabaseManager القديم في database.py لسه شغّال.
    - lazy init: ما بيتفتحش connection غير لما يتطلب.
    - thread-safe: كل connection بيتفتح في الـ thread اللي بيستخدمه.
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Sequence, Tuple, Union

# ---------------------------------------------------------------------------
# مسارات الـ DB — reuse من utils/db_paths.py (المصدر الموحّد للمسارات)
# ---------------------------------------------------------------------------
try:
    from utils.db_paths import DBPaths, get_db_path
except ImportError:
    # Fallback لو utils/ مش متاحة في الـ path
    import os
    _PROJECT_ROOT = Path(__file__).resolve().parents[2]
    _DB_DIR = Path(os.environ.get("DB_DIR", _PROJECT_ROOT / "db"))

    def _resolve(env_key: str, default_name: str) -> str:
        env_val = os.environ.get(env_key)
        if env_val:
            return str(Path(env_val).resolve())
        return str(_DB_DIR / default_name)

    class DBPaths:  # type: ignore[no-redef]
        STOCKS_DB = _resolve("STOCKS_DB", "stocks.db")
        PREDICTIONS_DB = _resolve("PREDICTIONS_DB", "predictions.db")
        PRICE_HISTORY_DB = _resolve("PRICE_HISTORY_DB", "price_history.db")
        DATA_ENGINE_DB = _resolve("DATA_ENGINE_DB", "data_engine.db")
        INTRADAY_DB = _resolve("INTRADAY_DB", "intraday.db")
        AUTH_DB = _resolve("AUTH_DB", "auth.db")
        CRYPTO_DB = _resolve("CRYPTO_DB", "crypto.db")
        CRYPTO_LEARNING_DB = _resolve("CRYPTO_LEARNING_DB", "crypto_learning.db")
        # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
        NEWS_DB = _resolve("NEWS_DB", "news.db")

    def get_db_path(name: str) -> str:
        name = name.lower().strip()
        if name.endswith(".db"):
            name = name[:-3]
        return _resolve(f"{name.upper()}_DB", f"{name}.db")


# ---------------------------------------------------------------------------
# خريطة الأسماء المستعارة → مسار DB فعلي
# ---------------------------------------------------------------------------
# الأسماء المختصرة اللي المحركات بتستخدمها. كل اسم بيرجّع مسار DB مطلق آمن.
_DB_ALIASES: Dict[str, str] = {
    # الـ 8 المعتمدة رئيسياً
    'stocks': DBPaths.STOCKS_DB,
    'predictions': DBPaths.PREDICTIONS_DB,
    'price_history': DBPaths.PRICE_HISTORY_DB,
    'data_engine': DBPaths.DATA_ENGINE_DB,
    'intraday': DBPaths.INTRADAY_DB,
    'auth': DBPaths.AUTH_DB,
    'crypto': DBPaths.CRYPTO_DB,
    'crypto_learning': DBPaths.CRYPTO_LEARNING_DB,
    # أسماء شائعة تانية (aliasing للقواعد المدمجة)
    'telegram_data': DBPaths.STOCKS_DB,        # Consolidated July 2026
    # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
    # Was STOCKS_DB (phantom — stocks.db has no market_news table). news.db is canonical.
    'news': DBPaths.NEWS_DB,
    'analytics': DBPaths.STOCKS_DB,            # Consolidated July 2026
    # v3.65.1: gold_prices canonical = data_engine.db (live, written by metals_forex_fetcher.py).
    # OLD: pointed at GOLD_PRICES_DB which defaulted to non-existent `gold_prices.db`.
    'gold_prices': DBPaths.DATA_ENGINE_DB,
    'historical': getattr(DBPaths, 'HISTORICAL_DB', DBPaths.PRICE_HISTORY_DB),
    'community': getattr(DBPaths, 'COMMUNITY_DB', DBPaths.STOCKS_DB),
}


def _resolve_db_name(name) -> str:
    """حوّل اسم مختصر → مسار DB مطلق. يدعم .db suffix وعناوين مطلقة."""
    if not name:
        raise ValueError("DB name cannot be empty")
    name = str(name)

    # لو مسار مطلق/نسبي مباشر لملف .db → استخدمه زي ما هو
    if name.endswith('.db') and ('/' in name or '\\' in name):
        return str(Path(name).resolve())

    # لو اسم مختصر في الـ aliases
    key = name.lower().strip()
    if key.endswith('.db'):
        key = key[:-3]
    if key in _DB_ALIASES:
        return _DB_ALIASES[key]

    # fallback: حاول عبر get_db_path (بيقرأ env var)
    try:
        return get_db_path(key)
    except Exception:
        # آخر محاولة: <db_dir>/<name>.db
        return str(Path(DBPaths.DB_DIR) / f"{key}.db")


# ---------------------------------------------------------------------------
# الـ DBManager — البوابة المركزية
# ---------------------------------------------------------------------------
class DBManager:
    """
    البوابة المركزية الموحّدة لكل عمليات الـ SQLite.

    Thread-safe singleton. كل connection بيتفتح fresh للـ thread بتاعها
    (SQLite connections مش thread-safe بطبيعتها).

    ضمانات الـ connection:
      - readonly (default): file:...?mode=ro مع busy_timeout=30000،
        fallback لـ immutable=1 لو الـ WAL -shm فاسد.
      - writable: journal_mode=WAL + busy_timeout=30000 + synchronous=NORMAL
        + wal_autocheckpoint=1000 + wal_checkpoint(TRUNCATE) بعد الكتابة.
    """

    _instance: Optional["DBManager"] = None
    _instance_lock = threading.Lock()

    def __new__(cls) -> "DBManager":
        """Singleton — كل المحركات بتستخدم نفس الـ instance."""
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self._lock = threading.Lock()
        # إحصائيات (للـ debugging/monitoring)
        self._stats: Dict[str, int] = {
            'reads': 0,
            'writes': 0,
            'errors': 0,
        }

    # -----------------------------------------------------------------
    # الـ connection الأساسي
    # -----------------------------------------------------------------
    @contextmanager
    def connection(
        self,
        db: str = 'stocks',
        writable: bool = False,
    ) -> Generator[sqlite3.Connection, None, None]:
        """
        افتح connection مع كل الضمانات (WAL/busy_timeout/immutable).

        Args:
            db: اسم الـ DB المختصر ('stocks', 'predictions', ...) أو مسار مباشر.
            writable: True للكتابة (WAL + auto-checkpoint)، False للقراءة (readonly/immutable).

        Yields:
            sqlite3.Connection جاهز للاستخدام. بيتقفل تلقائياً في الـ finally.
        """
        db_path = _resolve_db_name(db)
        conn: Optional[sqlite3.Connection] = None

        if writable:
            # --- writable connection: WAL + busy_timeout + synchronous=NORMAL ---
            try:
                conn = sqlite3.connect(db_path, timeout=30.0)
                conn.row_factory = sqlite3.Row
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA busy_timeout=30000')
                conn.execute('PRAGMA synchronous=NORMAL')
                conn.execute('PRAGMA wal_autocheckpoint=1000')
                conn.execute('PRAGMA foreign_keys=ON')
                # Health check
                conn.execute('SELECT 1').fetchone()
            except Exception:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        pass
                self._stats['errors'] += 1
                raise
        else:
            # --- readonly connection: mode=ro مع fallback لـ immutable=1 ---
            # mode=ro بيحترم الـ WAL (بيشوف آخر commits)، لكن لو الـ -shm فاسد
            # نتحوّل لـ immutable=1 (bypass WAL entirely — safe for reads).
            try:
                uri = f'file:{db_path}?mode=ro'
                conn = sqlite3.connect(uri, uri=True, timeout=30.0)
                conn.row_factory = sqlite3.Row
                conn.execute('PRAGMA busy_timeout=30000')
                conn.execute('PRAGMA query_only=1')  # ضمان إضافي: قراءة فقط
                conn.execute('SELECT 1').fetchone()
            except Exception as e_ro:
                first_err = e_ro
                try:
                    if conn:
                        conn.close()
                except Exception:
                    pass
                # Fallback: immutable=1 (bypasses WAL — safe for cold reads)
                try:
                    uri = f'file:{db_path}?immutable=1'
                    conn = sqlite3.connect(uri, uri=True, timeout=30.0)
                    conn.row_factory = sqlite3.Row
                    conn.execute('PRAGMA busy_timeout=30000')
                    conn.execute('SELECT 1').fetchone()
                except Exception as e_imm:
                    self._stats['errors'] += 1
                    raise RuntimeError(
                        f"[DBManager] readonly + immutable fallback both failed for '{db}' ({db_path}): "
                        f"ro={first_err}, imm={e_imm}"
                    ) from e_imm

        try:
            yield conn
            if writable:
                self._stats['writes'] += 1
                # auto-checkpoint بعد الكتابة عشان الـ WAL ميكبرش
                try:
                    conn.execute('PRAGMA wal_checkpoint(PASSIVE)')
                except Exception:
                    pass
            else:
                self._stats['reads'] += 1
        except Exception:
            self._stats['errors'] += 1
            raise
        finally:
            try:
                if conn:
                    conn.close()
            except Exception:
                pass

    # -----------------------------------------------------------------
    # get_connection — raw connection for callers that manage lifecycle
    # -----------------------------------------------------------------
    def get_connection(
        self,
        db: str = 'stocks',
        writable: bool = False,
    ) -> sqlite3.Connection:
        """
        افتح connection مباشر (بدون context manager).

        بيـ return sqlite3.Connection مباشر — الـ caller مسؤول عن close().

        استخدم ده لما تحتاج تحتفظ بالـ connection مفتوحة لفترة (زي في الـ loops
        الكبيرة في daily_predictor أو daily_closer). لا تستخدمه للأQueries الواحدة —
        استخدم query() بدلاً من ذلك.

        Args:
            db: اسم الـ DB المختصر أو مسار مباشر.
            writable: True للكتابة (WAL)، False للقراءة.

        Returns:
            sqlite3.Connection جاهز للاستخدام (caller must close()).
        """
        db_path = _resolve_db_name(db)
        conn: sqlite3.Connection = None

        if writable:
            conn = sqlite3.connect(db_path, timeout=30.0)
            conn.row_factory = sqlite3.Row
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=30000')
            conn.execute('PRAGMA synchronous=NORMAL')
            conn.execute('PRAGMA wal_autocheckpoint=1000')
            conn.execute('PRAGMA foreign_keys=ON')
        else:
            # readonly — use raw file path (NOT URI mode=ro) to avoid
            # the "closed database" bug when multiple connections share
            # the same DB file in the same thread.
            conn = sqlite3.connect(db_path, timeout=30.0)
            conn.row_factory = sqlite3.Row
            conn.execute('PRAGMA busy_timeout=30000')
            conn.execute('PRAGMA query_only=1')

        self._stats['reads'] += 1
        return conn

    # -----------------------------------------------------------------
    # دوال راحة (convenience)
    # -----------------------------------------------------------------
    def query(
        self,
        db: str,
        sql: str,
        params: Union[Tuple, Sequence, None] = (),
    ) -> List[Dict[str, Any]]:
        """
        نفّذ SELECT وارجع النتايج كـ list of dicts.

        Example:
            rows = db_manager.query('stocks', "SELECT ticker, name FROM stocks WHERE is_active=1 LIMIT 10")
        """
        with self.connection(db, writable=False) as conn:
            cur = conn.cursor()
            cur.execute(sql, tuple(params) if params else ())
            return [dict(row) for row in cur.fetchall()]

    def query_one(
        self,
        db: str,
        sql: str,
        params: Union[Tuple, Sequence, None] = (),
    ) -> Optional[Dict[str, Any]]:
        """SELECT صف واحد فقط (أو None لو مفيش)."""
        with self.connection(db, writable=False) as conn:
            cur = conn.cursor()
            cur.execute(sql, tuple(params) if params else ())
            row = cur.fetchone()
            return dict(row) if row else None

    def execute(
        self,
        db: str,
        sql: str,
        params: Union[Tuple, Sequence, None] = (),
    ) -> int:
        """
        نفّذ INSERT/UPDATE/DELETE. بيرجّع عدد الصفوف المتأثرة.

        Example:
            affected = db_manager.execute('predictions',
                "UPDATE predictions SET status = ? WHERE id = ?",
                ('CLOSED', pred_id))
        """
        with self.connection(db, writable=True) as conn:
            cur = conn.cursor()
            cur.execute(sql, tuple(params) if params else ())
            conn.commit()
            return cur.rowcount

    def execute_many(
        self,
        db: str,
        sql: str,
        params_list: Sequence[Sequence],
    ) -> int:
        """نفّذ INSERT/UPDATE لصفوف متعددة في transaction واحد."""
        with self.connection(db, writable=True) as conn:
            cur = conn.cursor()
            cur.executemany(sql, [tuple(p) for p in params_list])
            conn.commit()
            return cur.rowcount

    @contextmanager
    def transaction(self, db: str = 'stocks') -> Generator[sqlite3.Connection, None, None]:
        """
        افتح transaction صريح (BEGIN/COMMIT/ROLLBACK تلقائي).

        Example:
            with db_manager.transaction('predictions') as conn:
                conn.execute("INSERT INTO predictions (...) VALUES (...)", (...))
                conn.execute("UPDATE prediction_logs SET ... WHERE ...", (...))
            # commit تلقائي لو مفيش exception، rollback لو فيه
        """
        with self.connection(db, writable=True) as conn:
            try:
                conn.execute('BEGIN')
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    # -----------------------------------------------------------------
    # أدوات مساعدة
    # -----------------------------------------------------------------
    def table_exists(self, db: str, table_name: str) -> bool:
        """اتأكد إن جدول موجود في الـ DB."""
        row = self.query_one(
            db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,),
        )
        return row is not None

    def table_columns(self, db: str, table_name: str) -> List[str]:
        """ارجع أسماء أعمدة جدول (للـ schema validation)."""
        rows = self.query(db, f"PRAGMA table_info({table_name})")
        return [r['name'] for r in rows]

    def ensure_column(self, db: str, table_name: str, column_def: str) -> bool:
        """
        أضف عمود لو مش موجود (safe migration).

        Args:
            column_def: تعريف العمود كامل، مثال: "annual_return_rate REAL"

        Returns:
            True لو العمود اتضاف، False لو كان موجود.
        """
        col_name = column_def.split()[0]
        existing = self.table_columns(db, table_name)
        if col_name in existing:
            return False
        self.execute(db, f'ALTER TABLE {table_name} ADD COLUMN {column_def}')
        return True

    def get_stats(self) -> Dict[str, int]:
        """إحصائيات الاستخدام (reads/writes/errors)."""
        return dict(self._stats)

    def reset_stats(self) -> None:
        """صفر الإحصائيات."""
        with self._lock:
            self._stats = {'reads': 0, 'writes': 0, 'errors': 0}

    def health_check(self, db: str = 'stocks') -> Dict[str, Any]:
        """
        فحص صحة الـ DB (integrity_check + journal_mode + page_count).

        Returns:
            dict فيه: ok (bool), journal_mode, page_count, integrity.
        """
        try:
            with self.connection(db, writable=False) as conn:
                integrity = conn.execute('PRAGMA integrity_check').fetchone()[0]
                journal = conn.execute('PRAGMA journal_mode').fetchone()[0]
                page_count = conn.execute('PRAGMA page_count').fetchone()[0]
                return {
                    'db': db,
                    'path': _resolve_db_name(db),
                    'ok': integrity == 'ok',
                    'journal_mode': journal,
                    'page_count': page_count,
                    'integrity': integrity,
                }
        except Exception as e:
            return {
                'db': db,
                'path': _resolve_db_name(db),
                'ok': False,
                'error': str(e),
            }


# ---------------------------------------------------------------------------
# الـ singleton instance — دي النقطة الوحيدة اللي المحركات بتستخدمها
# ---------------------------------------------------------------------------
db_manager = DBManager()


# ---------------------------------------------------------------------------
# دوال مستوى الـ module (للـ backward compat مع الـ calls البسيطة)
# ---------------------------------------------------------------------------
def get_connection(db: str = 'stocks', writable: bool = False):
    """افتح connection مباشر (context manager)."""
    return db_manager.connection(db, writable=writable)


def query(db: str, sql: str, params=()) -> List[Dict[str, Any]]:
    """SELECT سريع."""
    return db_manager.query(db, sql, params)


def query_one(db: str, sql: str, params=()) -> Optional[Dict[str, Any]]:
    """SELECT صف واحد."""
    return db_manager.query_one(db, sql, params)


def execute(db: str, sql: str, params=()) -> int:
    """INSERT/UPDATE/DELETE."""
    return db_manager.execute(db, sql, params)


def resolve_path(db: str) -> str:
    """ارجع المسار المطلق للـ DB بدون فتح connection."""
    return _resolve_db_name(db)


# ---------------------------------------------------------------------------
# اختبار سريع (python3 core/db_manager.py)
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    print("=" * 60)
    print("DBManager Health Check — الـ 8 قواعد المعتمدة")
    print("=" * 60)
    for db_name in ['stocks', 'predictions', 'price_history', 'data_engine',
                    'intraday', 'auth', 'crypto', 'crypto_learning']:
        result = db_manager.health_check(db_name)
        status = "✅" if result.get('ok') else "❌"
        print(f"  {status} {db_name:20s} → {result.get('path', 'N/A')}")
        if not result.get('ok'):
            print(f"     error: {result.get('error', result.get('integrity', 'unknown'))}")
    print()
    print("Stats:", db_manager.get_stats())

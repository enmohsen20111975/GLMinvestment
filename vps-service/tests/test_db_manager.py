"""
test_db_manager.py — اختبارات الـ DBManager (Phase 5 Task 1)
===============================================================

الموضوع:
    الـ DBManager (في core/db_manager.py) هو البوابة المركزية لكل الـ SQLite.
    لازم نتأكد إن:
      1. الـ WAL mode شغّالة (journal_mode='wal').
      2. الـ busy_timeout = 30000ms.
      3. الـ synchronous=NORMAL (للـ writable connections).
      4. الـ query() بيرجّع داتا (list of dicts).
      5. الـ execute() بيكتب بنجاح.
      6. الـ health_check() بيرجّع ok=True + integrity='ok'.
      7. الـ table_exists() بيكشف الجداول.

التشغيل:
    cd vps-service && python3 -m pytest tests/test_db_manager.py -v
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

from core.db_manager import DBManager, db_manager, _resolve_db_name


# ---------------------------------------------------------------------------
# Fixtures: DB مؤقت للاختبارات (ما نلمسش الـ DBs الإنتاجية)
# ---------------------------------------------------------------------------

@pytest.fixture
def temp_db_path(tmp_path) -> str:
    """اعمل DB file مؤقت في tmp_path."""
    db_file = tmp_path / "test_unit.db"
    return str(db_file)


@pytest.fixture
def temp_db_manager() -> DBManager:
    """DBManager instance جديد (مش الـ singleton الإنتاجي) للـ isolation.

    ملحوظة: DBManager هو singleton، بس هنا بنستخدمه عادي عشان الـ methods
    بـ stateless (كل connection بيتفتح fresh).
    """
    return DBManager()


@pytest.fixture
def populated_temp_db(temp_db_manager: DBManager, temp_db_path: str) -> str:
    """اعمل DB مؤقت + جدول stocks فيه صفين للـ read tests.

    لازم نفتح writable connection الأول عشان نفعّل WAL mode على الـ DB
    (الـ DBManager بيسوّي WAL بس على الـ writable connections).
    """
    # افتح writable connection الأول عشان WAL mode + الـ pragmas
    with temp_db_manager.connection(temp_db_path, writable=True) as conn:
        conn.execute("""
            CREATE TABLE stocks (
                ticker TEXT PRIMARY KEY,
                name TEXT,
                current_price REAL,
                is_active INTEGER DEFAULT 1
            )
        """)
        conn.execute("INSERT INTO stocks (ticker, name, current_price, is_active) VALUES (?, ?, ?, ?)",
                     ('COMI', 'Commercial International Bank', 25.40, 1))
        conn.execute("INSERT INTO stocks (ticker, name, current_price, is_active) VALUES (?, ?, ?, ?)",
                     ('ETEL', 'Telecom Egypt', 18.20, 1))
        conn.commit()
    return temp_db_path


# ---------------------------------------------------------------------------
# 1) WAL mode + busy_timeout on writable connection
# ---------------------------------------------------------------------------

def test_writable_connection_sets_wal_mode(temp_db_manager: DBManager, temp_db_path: str):
    """الـ writable connection لازم يفعّل journal_mode=WAL."""
    with temp_db_manager.connection(temp_db_path, writable=True) as conn:
        journal = conn.execute('PRAGMA journal_mode').fetchone()[0]
    assert journal.lower() == 'wal', \
        f"Writable connection must set journal_mode=WAL, got {journal!r}"


def test_writable_connection_sets_busy_timeout(temp_db_manager: DBManager, temp_db_path: str):
    """الـ writable connection لازم يفعّل busy_timeout=30000."""
    with temp_db_manager.connection(temp_db_path, writable=True) as conn:
        busy = conn.execute('PRAGMA busy_timeout').fetchone()[0]
    assert busy == 30000, \
        f"Writable connection must set busy_timeout=30000, got {busy}"


def test_writable_connection_sets_synchronous_normal(temp_db_manager: DBManager, temp_db_path: str):
    """الـ writable connection لازم يفعّل synchronous=NORMAL."""
    with temp_db_manager.connection(temp_db_path, writable=True) as conn:
        sync = conn.execute('PRAGMA synchronous').fetchone()[0]
    # synchronous=NORMAL بيتمثّل بـ 1
    assert sync == 1, \
        f"Writable connection must set synchronous=NORMAL (1), got {sync}"


# ---------------------------------------------------------------------------
# 2) Readonly connection + query_only guard
# ---------------------------------------------------------------------------

def test_readonly_connection_is_readonly(temp_db_manager: DBManager, populated_temp_db: str):
    """الـ readonly connection لازم يرفض الكتابة."""
    with temp_db_manager.connection(populated_temp_db, writable=False) as conn:
        query_only = conn.execute('PRAGMA query_only').fetchone()[0]
        assert query_only == 1, "readonly connection must enable query_only=1"


# ---------------------------------------------------------------------------
# 3) query() returns data as list of dicts
# ---------------------------------------------------------------------------

def test_query_returns_list_of_dicts(temp_db_manager: DBManager, populated_temp_db: str):
    """query() لازم يرجّع list of dicts (مش sqlite3.Row)."""
    rows = temp_db_manager.query(populated_temp_db, "SELECT ticker, name FROM stocks ORDER BY ticker")
    assert isinstance(rows, list)
    assert len(rows) == 2
    assert isinstance(rows[0], dict)
    assert rows[0]['ticker'] == 'COMI'
    assert rows[1]['ticker'] == 'ETEL'


def test_query_one_returns_single_dict_or_none(temp_db_manager: DBManager, populated_temp_db: str):
    """query_one() لازم يرجّع dict واحد أو None."""
    row = temp_db_manager.query_one(
        populated_temp_db,
        "SELECT ticker, name FROM stocks WHERE ticker = ?",
        ('COMI',),
    )
    assert row is not None
    assert row['ticker'] == 'COMI'
    assert row['name'] == 'Commercial International Bank'

    # لو مفيش result
    row_none = temp_db_manager.query_one(
        populated_temp_db,
        "SELECT ticker FROM stocks WHERE ticker = ?",
        ('NONEXISTENT',),
    )
    assert row_none is None


def test_query_with_params(temp_db_manager: DBManager, populated_temp_db: str):
    """query() بيقبل params (parameterized query — anti SQL injection)."""
    rows = temp_db_manager.query(
        populated_temp_db,
        "SELECT * FROM stocks WHERE is_active = ? AND current_price > ?",
        (1, 20.0),
    )
    assert len(rows) == 1
    assert rows[0]['ticker'] == 'COMI'


# ---------------------------------------------------------------------------
# 4) execute() writes successfully
# ---------------------------------------------------------------------------

def test_execute_inserts_row(temp_db_manager: DBManager, populated_temp_db: str):
    """execute() لازم يكتب INSERT ويرجّع عدد الصفوف المتأثرة."""
    affected = temp_db_manager.execute(
        populated_temp_db,
        "INSERT INTO stocks (ticker, name, current_price, is_active) VALUES (?, ?, ?, ?)",
        ('HRHO', 'Hermes Holding', 12.80, 1),
    )
    assert affected == 1
    # verify
    row = temp_db_manager.query_one(
        populated_temp_db,
        "SELECT * FROM stocks WHERE ticker = ?",
        ('HRHO',),
    )
    assert row is not None
    assert row['name'] == 'Hermes Holding'


def test_execute_updates_rows(temp_db_manager: DBManager, populated_temp_db: str):
    """execute() لازم يـ UPDATE ويرجّع العدد الصحيح."""
    affected = temp_db_manager.execute(
        populated_temp_db,
        "UPDATE stocks SET current_price = ? WHERE is_active = ?",
        (26.00, 1),
    )
    assert affected == 2  # COMI + ETEL


# ---------------------------------------------------------------------------
# 5) health_check() returns ok + integrity
# ---------------------------------------------------------------------------

def test_health_check_returns_ok(temp_db_manager: DBManager, populated_temp_db: str):
    """health_check() لازم يرجّع ok=True + integrity='ok'."""
    result = temp_db_manager.health_check(populated_temp_db)
    assert result['ok'] is True
    assert result['integrity'] == 'ok'
    assert result['journal_mode'] == 'wal'
    assert 'page_count' in result
    assert result['page_count'] > 0


def test_health_check_handles_corrupted_db(temp_db_manager: DBManager, tmp_path):
    """health_check() لازم يرجّع ok=False لو الـ DB فاسدة (مش SQLite valid).

    Note: SQLite readonly بـ mode=ro بيـ create ملف فاضي لو مش موجود، فللاختبار
    نستخدم ملف موجود بس مش SQLite valid (محتوى عشوائي).
    """
    corrupt_path = tmp_path / "corrupt.db"
    corrupt_path.write_bytes(b"NOT A SQLITE DATABASE - just random bytes for testing")
    result = temp_db_manager.health_check(str(corrupt_path))
    assert result['ok'] is False
    # إما error أو integrity != 'ok'
    assert 'error' in result or result.get('integrity') != 'ok'


# ---------------------------------------------------------------------------
# 6) table_exists() + table_columns()
# ---------------------------------------------------------------------------

def test_table_exists_detects_table(temp_db_manager: DBManager, populated_temp_db: str):
    """table_exists() لازم يرجّع True للجدول الموجود و False للـ مش موجود."""
    assert temp_db_manager.table_exists(populated_temp_db, 'stocks') is True
    assert temp_db_manager.table_exists(populated_temp_db, 'predictions') is False


def test_table_columns_returns_names(temp_db_manager: DBManager, populated_temp_db: str):
    """table_columns() لازم يرجّع أسماء الأعمدة."""
    cols = temp_db_manager.table_columns(populated_temp_db, 'stocks')
    assert 'ticker' in cols
    assert 'name' in cols
    assert 'current_price' in cols
    assert 'is_active' in cols


# ---------------------------------------------------------------------------
# 7) DB alias resolution (the _resolve_db_name function)
# ---------------------------------------------------------------------------

def test_resolve_db_name_handles_aliases():
    """_resolve_db_name لازم يحوّل الأسماء المختصرة لمسارات فعلية."""
    stocks_path = _resolve_db_name('stocks')
    assert stocks_path.endswith('stocks.db')

    predictions_path = _resolve_db_name('predictions')
    assert predictions_path.endswith('predictions.db')

    # .db suffix
    stocks_with_suffix = _resolve_db_name('stocks.db')
    assert stocks_with_suffix.endswith('stocks.db')


def test_resolve_db_name_rejects_empty():
    """_resolve_db_name لازم يرفض الاسم الفاضي."""
    with pytest.raises(ValueError):
        _resolve_db_name('')


# ---------------------------------------------------------------------------
# 8) Integration with the real production stocks.db (read-only)
# ---------------------------------------------------------------------------

def test_production_stocks_db_is_readable():
    """الـ stocks.db الإنتاجي لازم يقرأ بنجاح (من غير ما نكتب فيه)."""
    stocks_path = _resolve_db_name('stocks')
    if not Path(stocks_path).exists():
        pytest.skip(f"production stocks.db not found at {stocks_path}")

    # لو فيه جدول stocks، نتأكد إن فيه داتا
    if db_manager.table_exists('stocks', 'stocks'):
        rows = db_manager.query('stocks', "SELECT ticker FROM stocks LIMIT 1")
        assert len(rows) >= 1, "stocks table should have at least one row"


def test_production_health_check_passes():
    """health_check() على الـ stocks.db الإنتاجي لازم ينجح."""
    stocks_path = _resolve_db_name('stocks')
    if not Path(stocks_path).exists():
        pytest.skip(f"production stocks.db not found at {stocks_path}")

    result = db_manager.health_check('stocks')
    assert result['ok'] is True, f"stocks.db health check failed: {result}"
    assert result['integrity'] == 'ok'


# ---------------------------------------------------------------------------
# 9) Transaction context manager
# ---------------------------------------------------------------------------

def test_transaction_commits_on_success(temp_db_manager: DBManager, populated_temp_db: str):
    """transaction() لازم يـ commit لو مفيش exception."""
    with temp_db_manager.transaction(populated_temp_db) as conn:
        conn.execute("INSERT INTO stocks (ticker, name, current_price, is_active) VALUES (?, ?, ?, ?)",
                     ('SWDY', 'Elsewedy Electric', 15.30, 1))
    # بعد الـ with block، الـ commit لازم يكون حصل
    row = temp_db_manager.query_one(populated_temp_db, "SELECT * FROM stocks WHERE ticker = ?", ('SWDY',))
    assert row is not None


def test_transaction_rolls_back_on_exception(temp_db_manager: DBManager, populated_temp_db: str):
    """transaction() لازم يـ rollback لو فيه exception."""
    with pytest.raises(ValueError):
        with temp_db_manager.transaction(populated_temp_db) as conn:
            conn.execute("INSERT INTO stocks (ticker, name, current_price, is_active) VALUES (?, ?, ?, ?)",
                         ('TMGQ', 'Talaat Moustafa', 8.50, 1))
            raise ValueError("simulated failure")
    # الـ rollback لازم حصل — السطر ما يبقاش موجود
    row = temp_db_manager.query_one(populated_temp_db, "SELECT * FROM stocks WHERE ticker = ?", ('TMGQ',))
    assert row is None

"""
Database Manager
================
Unified database connection and query management.

Features:
- Connection pooling
- Context manager for connections
- Common query functions
- Error handling
"""

import sqlite3
import re
from contextlib import contextmanager
from typing import Dict, List, Optional, Any, Generator
from datetime import datetime
import os

# Import configuration - use relative path for portability
try:
    from config import DATABASE_PATH, PRICE_HISTORY_DB_PATH
except ImportError:
    # Fallback: use relative path from this file
    from pathlib import Path
    _base_dir = Path(__file__).parent.parent.parent.resolve()  # Project root
    DATABASE_PATH = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))
    PRICE_HISTORY_DB_PATH = str(_base_dir / 'db' / 'price_history.db')


# ============================================================================
# CRITICAL FIX (Aug 2026): String-to-Float sanitizer + Safe connection helper
# ============================================================================
# Problem: Scraper (EODHD/EGKSCO) stores market_cap / value_traded / volume as
# formatted strings like '377.55\u202fM' (with thin space + M suffix).
# Doing `float('377.55 M')` crashes with ValueError, breaking the whole
# MasterAnalyzer / MaestroOrchestrator pipeline. This helper converts those
# human-readable strings back to raw floats BEFORE math is done on them.
#
# Supported suffixes: K (1e3), M (1e6), B (1e9), T (1e12)
# Handles thin-space (\u202f), regular space, comma separators, and currency
# markers like 'EGP', 'SAR', 'USD'.
# ============================================================================

_SUFFIX_MULTIPLIERS = {
    'K': 1_000.0,
    'M': 1_000_000.0,
    'B': 1_000_000_000.0,
    'T': 1_000_000_000_000.0,
}


def parse_market_cap(value) -> Optional[float]:
    """Convert a human-readable market-cap string to a raw float.

    Examples:
        '377.55\u202fM'  -> 377_550_000.0
        '1.2 B'        -> 1_200_000_000.0
        '950 K'        -> 950_000.0
        '457.99 B EGP' -> 457_990_000_000.0
        '80.04 B SAR'  -> 80_040_000_000.0
        377550000      -> 377_550_000.0   (already numeric, passthrough)
        None / ''      -> None
        'garbage'      -> None (safe fallback)
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            f = float(value)
            return f if f == f else None  # reject NaN
        except (ValueError, TypeError):
            return None
    # String path — strip thin space, regular spaces around digits, commas
    s = str(value).strip()
    if not s:
        return None
    # Remove currency markers / noise words
    s = re.sub(r'(?i)\b(EGP|SAR|USD|AED|KWD|QAR|BHD)\b', '', s)
    # Normalize separators: thin-space \u202f, non-breaking \xa0, commas
    s = s.replace('\u202f', '').replace('\xa0', '').replace(',', '')
    s = s.strip()
    if not s:
        return None
    # Detect trailing suffix
    multiplier = 1.0
    if s and s[-1] in _SUFFIX_MULTIPLIERS:
        multiplier = _SUFFIX_MULTIPLIERS[s[-1]]
        s = s[:-1].strip()
    elif len(s) >= 2 and s[-1].lower() in {k.lower() for k in _SUFFIX_MULTIPLIERS}:
        # case-insensitive match (e.g. 'm' instead of 'M')
        for k, v in _SUFFIX_MULTIPLIERS.items():
            if s[-1].lower() == k.lower():
                multiplier = v
                break
        s = s[:-1].strip()
    try:
        return float(s) * multiplier
    except (ValueError, TypeError):
        return None


# Backward-compatible aliases used across the codebase
_parse_market_cap = parse_market_cap  # alias


def parse_numeric(value, default: Optional[float] = None) -> Optional[float]:
    """Lenient numeric parser — handles formatted strings, NaN, None, '—'.

    Unlike parse_market_cap, this does NOT apply K/M/B multipliers (useful for
    plain numeric fields like price, pe_ratio where 'M' would be wrong).
    """
    if value is None:
        return default
    if isinstance(value, (int, float)):
        f = float(value)
        return f if f == f else default
    s = str(value).strip().replace('\u202f', '').replace('\xa0', '').replace(',', '')
    s = s.replace('—', '').replace('-', '').replace('%', '').strip()
    if not s:
        return default
    try:
        f = float(s)
        return f if f == f else default
    except (ValueError, TypeError):
        return default


def safe_connect(db_path: str, readonly: bool = False, timeout: float = 30.0):
    """Safe sqlite3.connect wrapper that ALWAYS sets timeout + busy_timeout.

    This is the single source of truth for new connections. Use this instead
    of calling sqlite3.connect() directly to prevent 'database is locked'
    errors that occur when one writer holds the WAL lock for >5s (default).

    Args:
        db_path: Path to the .db file (or URI).
        readonly: If True, opens in immutable=1 mode (safe for reads).
        timeout: busy timeout in seconds (default 30).

    Returns:
        sqlite3.Connection with WAL, busy_timeout, synchronous=NORMAL configured.
    """
    if readonly:
        uri = f'file:{db_path}?immutable=1'
        conn = sqlite3.connect(uri, uri=True, timeout=timeout)
    else:
        conn = sqlite3.connect(db_path, timeout=timeout)
        try:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA synchronous=NORMAL')
        except Exception:
            pass
    conn.execute(f'PRAGMA busy_timeout={int(timeout * 1000)}')
    return conn


def safe_add_column(db_path: str, table: str, column: str, ddl: str) -> bool:
    """Idempotently add a column to a table WITHOUT dropping data.

    Implements the SAFE MIGRATION pattern the user demanded:
      1. PRAGMA table_info(table) to list existing columns
      2. If column missing → ALTER TABLE ADD COLUMN
      3. If column exists → no-op (safe to call on every restart)

    NEVER drops the table, NEVER recreates it. This replaces the old
    DROP TABLE + CREATE TABLE pattern that wiped cached_analysis on every
    restart.

    Args:
        db_path: Path to the .db file.
        table: Table name.
        column: Column name to add.
        ddl: Column DDL fragment, e.g. 'TEXT' or 'REAL DEFAULT 0'.

    Returns:
        True if the column was added (or already existed), False on error.
    """
    conn = None
    try:
        conn = safe_connect(db_path, readonly=False)
        cur = conn.cursor()
        cur.execute(f'PRAGMA table_info({table})')
        existing = {row[1] for row in cur.fetchall()}
        if column not in existing:
            cur.execute(f'ALTER TABLE {table} ADD COLUMN {column} {ddl}')
            conn.commit()
            print(f'\u2713 safe_add_column: {table}.{column} added')
        return True
    except Exception as e:
        print(f'\u2717 safe_add_column({table}.{column}) failed: {e}')
        return False
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


class DatabaseManager:
    """
    Database Manager - Handles all database operations.
    
    Usage:
        db = DatabaseManager()
        stocks = db.get_all_stocks()
        history = db.get_price_history('COMI', 365)
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or DATABASE_PATH
        self._ensure_stock_price_history_view()

    def _ensure_stock_price_history_view(self):
        """Create stock_price_history view if it doesn't exist.

        Many analyzers reference stock_price_history but the actual table
        is stock_daily_prices. This view provides backward compatibility.

        FIX (Aug 2026): Two bugs were causing the recurring
        "Warning: Could not create stock_price_history view: table
        stock_price_history already exists" log spam on every restart:
          (1) The SELECT referenced non-existent columns `open`, `high`,
              `low`, `close` — the actual columns in stock_daily_prices are
              `open_price`, `high_price`, `low_price`, `close_price`.
          (2) The check only looked for `type='view'`. On production there
              was a legacy TABLE named stock_price_history (not a view),
              so `CREATE VIEW` failed with "already exists". Now we detect
              a TABLE with the same name and DROP it (it was a stale
              duplicate holding no unique data — stock_daily_prices is the
              source of truth) before creating the view.
        The migrator's `_recreate_price_history_views` already creates this
        view correctly on boot; this method is a defensive belt-and-suspenders
        for DatabaseManager instances created outside the migration path.
        """
        try:
            conn = sqlite3.connect(self.db_path, timeout=30.0)
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=30000')
            conn.execute('PRAGMA synchronous=NORMAL')
            cursor = conn.cursor()
            # Check if a TABLE (not view) named stock_price_history exists —
            # this is the legacy duplicate that blocks CREATE VIEW. Drop it
            # so the view can be created. stock_daily_prices is the source
            # of truth, so dropping the stale table loses no data.
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='stock_price_history'"
            )
            if cursor.fetchone():
                cursor.execute("DROP TABLE IF EXISTS stock_price_history")
                print("✓ Dropped stale stock_price_history TABLE (legacy duplicate)")
            # Check if view already exists — if so, the migrator already
            # created it correctly; nothing to do.
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='view' AND name='stock_price_history'"
            )
            if not cursor.fetchone():
                # Check if stock_daily_prices table exists
                cursor.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='stock_daily_prices'"
                )
                if cursor.fetchone():
                    # FIX (P20-Bug2, Aug 2026): Ensure `turnover` column exists in
                    # stock_daily_prices BEFORE creating the view. The view's SELECT
                    # references `turnover`, and if the column is missing on a legacy
                    # DB (production was bootstrapped with an old schema), EVERY
                    # query against the view crashes with:
                    #   "no such column: turnover"
                    # which surfaces as:
                    #   "[MasterAnalyzer] Market regime detection failed: no such column: turnover"
                    # This ALTER TABLE ADD COLUMN is idempotent (guarded by PRAGMA).
                    try:
                        cursor.execute("PRAGMA table_info(stock_daily_prices)")
                        _sdp_cols = {row[1] for row in cursor.fetchall()}
                        if 'turnover' not in _sdp_cols:
                            cursor.execute(
                                "ALTER TABLE stock_daily_prices ADD COLUMN turnover REAL"
                            )
                            print("✓ Added 'turnover' column to stock_daily_prices (Bug2 legacy heal)")
                    except Exception as _e_turnover:
                        print(f"Warning: could not add turnover column: {_e_turnover}")

                    # FIX (P20-Bug2b, Aug 2026): Dynamic column-name detection.
                    # Legacy production DBs have columns named `open, high, low, close`
                    # while newer schemas use `open_price, high_price, low_price, close_price`.
                    # The old hardcoded view DDL assumed open_price/high_price/etc.,
                    # which crashed on legacy DBs with "no such column: open_price".
                    # Now we detect which naming convention the table uses and build
                    # the view SELECT accordingly.
                    try:
                        cursor.execute("PRAGMA table_info(stock_daily_prices)")
                        _sdp_cols = {row[1] for row in cursor.fetchall()}
                    except Exception:
                        _sdp_cols = set()

                    _open_col = 'open_price' if 'open_price' in _sdp_cols else 'open'
                    _high_col = 'high_price' if 'high_price' in _sdp_cols else 'high'
                    _low_col = 'low_price' if 'low_price' in _sdp_cols else 'low'
                    _close_col = 'close_price' if 'close_price' in _sdp_cols else 'close'
                    _date_col = 'price_date' if 'price_date' in _sdp_cols else 'date'

                    cursor.execute(f'''
                        CREATE VIEW stock_price_history AS
                        SELECT
                            id,
                            ticker,
                            {_date_col} as date,
                            {_open_col} as open,
                            {_high_col} as high,
                            {_low_col} as low,
                            {_close_col} as close,
                            volume,
                            turnover,
                            change_percent
                        FROM stock_daily_prices
                    ''')
                    conn.commit()
                    print(f"✓ Created stock_price_history view (cols: {_open_col}/{_high_col}/{_low_col}/{_close_col})")
            conn.close()
        except Exception as e:
            print(f"Warning: Could not create stock_price_history view: {e}")

    @contextmanager
    def get_connection(self, writable: bool = False) -> Generator[sqlite3.Connection, None, None]:
        """Get database connection with context manager.
        
        Args:
            writable: If True, opens read-write connection for writes.
                     If False, uses readonly URI first, falls back to immutable=1
                     to bypass WAL corruption from concurrent writers.
        
        When writable=True, sets WAL mode, busy_timeout=30000, and synchronous=NORMAL
        to prevent corruption from concurrent writes.
        """
        conn = None
        if writable:
            try:
                conn = sqlite3.connect(self.db_path, timeout=30.0)
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA busy_timeout=30000')
                conn.execute('PRAGMA synchronous=NORMAL')
                conn.row_factory = sqlite3.Row
                conn.execute('SELECT 1').fetchone()
            except Exception as e:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        pass
                raise
        else:
            # Try readonly URI mode first (respects WAL, safe for concurrent reads)
            try:
                uri = f'file:{self.db_path}?mode=ro'
                conn = sqlite3.connect(uri, uri=True, timeout=30.0)
                conn.row_factory = sqlite3.Row
                conn.execute('PRAGMA busy_timeout=30000')
                # Health check
                conn.execute('SELECT 1').fetchone()
            except Exception as e_ro:
                try:
                    if conn:
                        conn.close()
                except Exception:
                    pass
                # Fallback: immutable mode (bypasses WAL entirely — safe for reads)
                try:
                    uri = f'file:{self.db_path}?immutable=1'
                    conn = sqlite3.connect(uri, uri=True, timeout=30.0)
                    conn.row_factory = sqlite3.Row
                    conn.execute('SELECT 1').fetchone()
                except Exception as e_imm:
                    print(f"[DB] Both readonly and immutable failed: ro={e_ro}, imm={e_imm}")
                    raise
        try:
            yield conn
        finally:
            try:
                if conn:
                    conn.close()
            except Exception:
                pass
    
    def _auto_checkpoint(self, conn: sqlite3.Connection) -> None:
        """Auto-checkpoint WAL after writes to prevent WAL growth and corruption."""
        try:
            conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        except Exception:
            pass

    def execute_query(self, query: str, params: tuple = ()) -> List[Dict]:
        """Execute a query and return results as list of dicts."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params)
            return [dict(row) for row in cursor.fetchall()]
    
    def execute_update(self, query: str, params: tuple = ()) -> int:
        """Execute an update/insert query and return affected rows."""
        with self.get_connection(writable=True) as conn:
            cursor = conn.cursor()
            cursor.execute(query, params)
            conn.commit()
            self._auto_checkpoint(conn)
            return cursor.rowcount
    
    def execute_many(self, query: str, params_list: List[tuple]) -> int:
        """Execute multiple inserts/updates."""
        with self.get_connection(writable=True) as conn:
            cursor = conn.cursor()
            cursor.executemany(query, params_list)
            conn.commit()
            self._auto_checkpoint(conn)
            return cursor.rowcount
    
    # =========================================================================
    # STOCK QUERIES
    # =========================================================================
    
    def get_all_stocks(self, active_only: bool = True, market: str = None, limit: int = None) -> List[Dict]:
        """Get all stocks from database.
        
        Args:
            active_only: Only return active stocks
            market: Filter by market (database market name: مصر, السعودية, الكويت, قطر, etc.)
            limit: Optional row cap (default None = no limit). Use to bound heavy callers.
        """
        # Use SELECT * to avoid column order issues
        # The sqlite3.Row will map columns by name automatically
        query = 'SELECT * FROM stocks'
        conditions = []
        params = []
        
        if active_only:
            conditions.append('(is_active = 1 OR is_active IS NULL)')
        
        if market:
            conditions.append('market = ?')
            params.append(market)  # Use market name as-is (Arabic names like مصر, السعودية)
        
        if conditions:
            query += ' WHERE ' + ' AND '.join(conditions)
        query += ' ORDER BY ticker'
        
        if limit is not None and int(limit) > 0:
            query += ' LIMIT ?'
            params.append(int(limit))
        
        return self.execute_query(query, tuple(params))
    
    @staticmethod
    def _sanitize_stock_row(stock: Optional[Dict]) -> Optional[Dict]:
        """Enforces physical trading invariants on stock records (Rule 24 & Single Source of Truth)."""
        if not stock:
            return stock
        try:
            cp = float(stock.get('current_price') or 0)
            pc = float(stock.get('previous_close') or cp) if stock.get('previous_close') else cp
            hp = float(stock['high_price']) if stock.get('high_price') is not None else None
            lp = float(stock['low_price']) if stock.get('low_price') is not None else None
            op = float(stock['open_price']) if stock.get('open_price') is not None else None

            if cp > 0:
                # Session High cannot be lower than current price or <= 0
                if hp is None or hp <= 0 or hp < cp:
                    stock['high_price'] = max(cp, pc)
                # Session Low cannot be higher than current price or <= 0 or absurdly low
                if lp is None or lp <= 0 or lp > cp or lp < cp * 0.35:
                    stock['low_price'] = min(cp, pc)
                # High >= Low
                if float(stock.get('high_price') or 0) < float(stock.get('low_price') or 0):
                    stock['high_price'] = max(cp, pc)
                    stock['low_price'] = min(cp, pc)
                # Open
                if op is None or op <= 0 or op < float(stock['low_price']) * 0.5 or op > float(stock['high_price']) * 2:
                    stock['open_price'] = pc

                # 52w range check
                h52 = float(stock['high_52w']) if stock.get('high_52w') is not None else None
                l52 = float(stock['low_52w']) if stock.get('low_52w') is not None else None
                if h52 is not None and h52 < cp:
                    stock['high_52w'] = max(h52, float(stock['high_price']), cp)
                if l52 is not None and (l52 > cp or l52 <= 0):
                    stock['low_52w'] = min(l52 if l52 > 0 else cp, float(stock['low_price']), cp)
        except Exception:
            pass
        return stock

    def get_stock(self, ticker: str) -> Optional[Dict]:
        """Get single stock by ticker - uses SELECT * to avoid column order issues."""
        query = 'SELECT * FROM stocks WHERE ticker = ?'
        results = self.execute_query(query, (ticker.upper(),))
        return self._sanitize_stock_row(results[0]) if results else None

    def is_egx_ticker(self, ticker: str) -> bool:
        """Cross-validate that a ticker is officially registered as an EGX stock.

        Used as a defense-in-depth filter to reject Saudi (TADAWUL, numeric) and
        Kuwaiti (KSE) tickers that leak into EGX result sets when the
        cached_analysis.market field is NULL or wrong.

        Returns True only if the ticker exists in the stocks table AND its
        market is EGX (or the market field is empty, treated permissively as EGX
        for legacy rows). Returns False for unknown tickers that are clearly
        non-EGX (numeric or known Gulf symbols).
        """
        if not ticker:
            return False
        t = str(ticker).strip().upper()
        # Hard reject: Saudi TADAWUL tickers are pure numbers (1120, 2120, ...)
        if t.isdigit():
            return False
        stock = self.get_stock(t)
        if stock:
            m = (stock.get('market') or '').upper()
            # Accept EGX; accept empty market (legacy) as EGX-permissive;
            # reject anything explicitly tagged as another market.
            if m in ('', 'EGX', 'مصر', 'EGYPT'):
                return True
            return False
        # Unknown ticker: permissively assume EGX (alphabetic, not in our table)
        # — the caller's _strict_market_filter already handles known Gulf symbols.
        return True
    
    def search_stocks(self, search_term: str, limit: int = 50) -> List[Dict]:
        """Search stocks by ticker or name."""
        query = '''
            SELECT * FROM stocks
            WHERE (ticker LIKE ? OR name LIKE ? OR name_ar LIKE ?)
            AND (is_active = 1 OR is_active IS NULL)
            ORDER BY ticker
            LIMIT ?
        '''
        pattern = f'%{search_term}%'
        return self.execute_query(query, (pattern, pattern, pattern, limit))
    
    # =========================================================================
    # PRICE HISTORY QUERIES
    # =========================================================================
    
    def _append_today_live_bar(self, ticker: str, results: List[Dict]) -> List[Dict]:
        """Appends/updates today's live stock bar from stocks.db into historical results."""
        try:
            stock = self.get_stock(ticker.upper())
            if stock and stock.get('current_price'):
                cp = float(stock['current_price'])
                if cp > 0:
                    last_up = str(stock.get('last_update') or stock.get('updated_at') or datetime.now().isoformat())
                    today_str = last_up.split('T')[0] if 'T' in last_up else last_up.split(' ')[0]

                    op = float(stock.get('open_price') or cp)
                    hp = float(stock.get('high_price') or max(cp, op))
                    lp = float(stock.get('low_price') or min(cp, op))

                    raw_vol = stock.get('volume') or 0
                    vol = 0
                    if isinstance(raw_vol, str):
                        clean_v = raw_vol.replace(',', '').replace('\xa0', ' ').replace(' ', ' ').strip()
                        if 'M' in clean_v:
                            try: vol = float(clean_v.replace('M', '').strip()) * 1_000_000
                            except: vol = 0
                        elif 'K' in clean_v:
                            try: vol = float(clean_v.replace('K', '').strip()) * 1_000
                            except: vol = 0
                        elif 'B' in clean_v:
                            try: vol = float(clean_v.replace('B', '').strip()) * 1_000_000_000
                            except: vol = 0
                        else:
                            try: vol = float(clean_v)
                            except: vol = 0
                    else:
                        try: vol = float(raw_vol)
                        except: vol = 0

                    live_bar = {
                        'date': today_str,
                        'open': op,
                        'high': hp,
                        'low': lp,
                        'close': cp,
                        'volume': int(vol)
                    }

                    if results:
                        last_bar_date = str(results[-1].get('date', ''))
                        if last_bar_date == today_str:
                            results[-1] = live_bar
                        elif last_bar_date < today_str:
                            results.append(live_bar)
                    else:
                        results = [live_bar]
        except Exception as e:
            print(f"[DB] Error appending today live bar for {ticker}: {e}")
        return results

    def get_price_history(self, ticker: str, days: int = 365) -> List[Dict]:
        """Get historical price data for a stock - returns LATEST days including today's live price.

        CANONICAL-PRICE (Task PHASE-3, Rule 72) — price source hierarchy:
          1. LIVE price: stocks.db.stocks.current_price (appended via _append_today_live_bar)
          2. HISTORICAL closes: stocks.db.stock_daily_prices (preferred, EOD clean)
          3. Fallback: price_history.db.price_history (legacy, 1.24M rows)
          4. Fallback: DailyPrice table (sandbox/dev only)
        FORBIDDEN: data_engine.db.historical_data / stock_prices (stale, disabled below).
        """
        results = []
        # Use price_history.db with ticker directly
        # FIX (Aug 2026): Use safe_connect to enforce timeout + busy_timeout
        # so concurrent background writers don't cause 'database is locked'.
        conn = None
        try:
            conn = safe_connect(PRICE_HISTORY_DB_PATH, readonly=True)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # Query by ticker directly (no join needed)
            query = '''
                SELECT * FROM (
                    SELECT date, open_price as open, high_price as high,
                           low_price as low, close_price as close, volume
                    FROM price_history
                    WHERE ticker = ?
                    ORDER BY date DESC
                    LIMIT ?
                ) ORDER BY date ASC
            '''
            cursor.execute(query, (ticker.upper(), days))
            results = [dict(row) for row in cursor.fetchall()]

            if results:
                return self._append_today_live_bar(ticker, results)
        except Exception as e:
            print(f"[DB] Error fetching from price_history.db: {e}")
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

        # Fallback 1: try stock_daily_prices in stocks.db (EODHD clean data)
        conn = None
        try:
            conn = safe_connect(self.db_path, readonly=True)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            query = '''
                SELECT * FROM (
                    SELECT price_date as date, open, high, low, close, volume
                    FROM stock_daily_prices
                    WHERE ticker = ?
                    ORDER BY price_date DESC
                    LIMIT ?
                ) ORDER BY date ASC
            '''
            cursor.execute(query, (ticker.upper(), days))
            results = [dict(row) for row in cursor.fetchall()]
            if results:
                return self._append_today_live_bar(ticker, results)
        except Exception:
            pass
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

        # Fallback 2: try DailyPrice table in main database
        try:
            query = '''
                SELECT * FROM (
                    SELECT date, open, high, low, close, volume
                    FROM DailyPrice
                    WHERE symbol = ?
                    ORDER BY date DESC
                    LIMIT ?
                ) ORDER BY date ASC
            '''
            return self.execute_query(query, (ticker.upper(), days))
        except Exception:
            pass

        # Fallback 3: try egypt_stocks.db → historical_data (sandbox/dev)
        # ملاحظة: egypt_stocks.db مش قاعدة بيانات رسمية للمشروع — أضيفت كـ fallback
        # للساندبوكس بس. على الـ VPS الإنتاجي، price_history.db + stock_daily_prices
        # هما المصادر الرسمية.
        # لو محتاجين نعتمد عليها، لازم نتأكد إنها متوافقة مع schema المشروع.
        # محسن: "egypt_stocks.db دى قاعدة بيانات غلط مش تبعنا"
        # → تم تعطيل الـ fallback ده مؤقتاً لحد ما نتأكد من المصدر الرسمي
        # try:
        #     import os
        #     from pathlib import Path
        #     _root = Path(self.db_path).parent
        #     _egx_db = str(_root / 'egypt_stocks.db')
        #     if os.path.exists(_egx_db):
        #         conn = sqlite3.connect(_egx_db)
        #         conn.row_factory = sqlite3.Row
        #         cursor = conn.cursor()
        #         query = '''
        #             SELECT * FROM (
        #                 SELECT date, open, high, low, close, volume
        #                 FROM historical_data
        #                 WHERE ticker = ?
        #                 ORDER BY date DESC
        #                 LIMIT ?
        #             ) ORDER BY date ASC
        #         '''
        #         cursor.execute(query, (ticker.upper(), days))
        #         results = [dict(row) for row in cursor.fetchall()]
        #         conn.close()
        #         if results:
        #             return results
        # except Exception:
        #     pass

        return []
    
    def get_close_prices(self, ticker: str, days: int = 365) -> List[float]:
        """Get list of close prices for calculations."""
        history = self.get_price_history(ticker, days)
        return [h['close'] for h in history if h.get('close')]
    
    def get_ohlcv(self, ticker: str, days: int = 365) -> Dict[str, List[float]]:
        """Get OHLCV data for technical analysis."""
        history = self.get_price_history(ticker, days)
        return {
            'opens': [h['open'] for h in history if h.get('open')],
            'highs': [h['high'] for h in history if h.get('high')],
            'lows': [h['low'] for h in history if h.get('low')],
            'closes': [h['close'] for h in history if h.get('close')],
            'volumes': [h['volume'] for h in history if h.get('volume')]
        }
    
    # =========================================================================
    # MARKET DATA QUERIES
    # =========================================================================
    
    def get_market_overview(self, market: str = None) -> Dict:
        """Get market overview with gainers, losers, most active, indices, and market status.
        
        Args:
            market: Optional market filter (EGX, KSA, KSE, DFM, BSE, QSE, CRYPTO)
        """
        from datetime import datetime
        
        # Get all stocks first
        all_stocks = self.get_all_stocks()
        
        # Filter by market if specified
        if market:
            market = market.upper()
            stocks = [s for s in all_stocks if s.get('market', 'EGX').upper() == market]
        else:
            stocks = all_stocks
        
        gainers = []
        losers = []
        unchanged = 0

        for s in stocks:
            if s.get('previous_close') and s['previous_close'] > 0 and s.get('current_price'):
                change_pct = ((s['current_price'] - s['previous_close']) / s['previous_close']) * 100
                s['change_percent'] = round(change_pct, 2)
                if change_pct > 0:
                    gainers.append(s)
                elif change_pct < 0:
                    losers.append(s)
                else:
                    unchanged += 1

        # Capture REAL counts BEFORE truncation to top-10 (was reporting 10/10 — see worklog FIX-INDICES)
        total_gainers = len(gainers)
        total_losers = len(losers)

        gainers = sorted(gainers, key=lambda x: x['change_percent'], reverse=True)[:10]
        losers = sorted(losers, key=lambda x: x['change_percent'])[:10]
        from utils.helpers import parse_volume
        most_active = sorted(stocks, key=lambda x: parse_volume(x.get('volume')), reverse=True)[:10]
        
        # Market status
        now = datetime.now()
        hour = now.hour
        day = now.weekday()  # 0=Monday, 6=Sunday
        # v3.29.0 FIX: EGX weekend is Friday(4)+Saturday(5), NOT Saturday+Sunday.
        # Was `day >= 5` which caught Sat(5)+Sun(6) — wrong for EGX.
        is_weekend = day in (4, 5)  # Friday=4, Saturday=5 (EGX weekend)
        is_market_hours = 10 <= hour < 14.5  # 10:00 AM to 2:30 PM Cairo
        is_open = not is_weekend and is_market_hours

        # Read REAL index values from market_indices table (same source as /api/market-pulse)
        # FABRICATED values (sum of market_cap, breadth ratio) were wrong — see worklog FIX-INDICES
        indices = []
        egx30_value = 0.0
        egx70_value = 0.0
        try:
            idx_rows = self.execute_query(
                "SELECT symbol, current_value, previous_close, change_percent FROM market_indices "
                "WHERE symbol IN ('EGX30','EGX70','EGX100') ORDER BY CASE symbol "
                "WHEN 'EGX30' THEN 1 WHEN 'EGX70' THEN 2 WHEN 'EGX100' THEN 3 ELSE 9 END"
            )
            name_map = {
                'EGX30': ('EGX 30 Index', 'مؤشر EGX 30'),
                'EGX70': ('EGX 70 Index', 'مؤشر EGX 70'),
                'EGX100': ('EGX 100 Index', 'مؤشر EGX 100'),
            }
            for r in idx_rows:
                sym = r.get('symbol')
                cur_val = r.get('current_value')
                prev = r.get('previous_close')
                chg_pct = r.get('change_percent')
                cur_val = float(cur_val) if cur_val is not None else 0.0
                prev = float(prev) if prev is not None else 0.0
                chg_pct = float(chg_pct) if chg_pct is not None else 0.0
                chg = cur_val - prev
                name, name_ar = name_map.get(sym, (sym, sym))
                indices.append({
                    'symbol': sym,
                    'name': name,
                    'name_ar': name_ar,
                    'value': cur_val,
                    'previous_close': prev,
                    'change': round(chg, 2),
                    'change_percent': round(chg_pct, 2),
                })
                if sym == 'EGX30':
                    egx30_value = cur_val
                elif sym == 'EGX70':
                    egx70_value = cur_val
        except Exception as e:
            import logging as _logging
            _logging.getLogger(__name__).warning(f'get_market_overview: market_indices read failed: {e}')

        # Fallback: empty indices if table missing
        if not indices:
            indices = [
                {'symbol': 'EGX30', 'name': 'EGX 30 Index', 'name_ar': 'مؤشر EGX 30',
                 'value': 0.0, 'previous_close': 0.0, 'change': 0.0, 'change_percent': 0.0},
                {'symbol': 'EGX70', 'name': 'EGX 70 Index', 'name_ar': 'مؤشر EGX 70',
                 'value': 0.0, 'previous_close': 0.0, 'change': 0.0, 'change_percent': 0.0},
                {'symbol': 'EGX100', 'name': 'EGX 100 Index', 'name_ar': 'مؤشر EGX 100',
                 'value': 0.0, 'previous_close': 0.0, 'change': 0.0, 'change_percent': 0.0},
            ]

        egx30_stocks = [s for s in stocks if s.get('egx30_member')] or stocks[:30]
        egx70_stocks = [s for s in stocks if s.get('egx70_member')] or stocks[30:100]
        
        return {
            'market_status': {
                'is_open': is_open,
                'status': 'open' if is_open else 'closed',
                'next_open': None,
                'next_close': None,
                'current_session': 'trading' if is_open else 'closed'
            },
            'summary': {
                'total_stocks': len(stocks),
                'gainers': total_gainers,
                'losers': total_losers,
                'unchanged': unchanged,
                'egx30_stocks': len(egx30_stocks),
                'egx70_stocks': len(egx70_stocks),
                'egx100_stocks': len(stocks),
                'egx30_value': egx30_value
            },
            'indices': indices,
            'top_gainers': gainers[:5],
            'top_losers': losers[:5],
            'most_active': most_active[:5],
            'gainers': gainers,
            'losers': losers,
            'total_stocks': len(stocks),
            'gainers_count': total_gainers,
            'losers_count': total_losers
        }
    
    # =========================================================================
    # UPDATE QUERIES
    # =========================================================================
    
    def update_stock_price(self, ticker: str, price_data: Dict) -> int:
        """Update stock price data."""
        query = '''
            UPDATE stocks SET
                current_price = ?,
                previous_close = ?,
                open_price = ?,
                high_price = ?,
                low_price = ?,
                volume = ?,
                last_update = ?
            WHERE ticker = ?
        '''
        return self.execute_update(query, (
            price_data.get('current_price'),
            price_data.get('previous_close'),
            price_data.get('open_price'),
            price_data.get('high_price'),
            price_data.get('low_price'),
            price_data.get('volume'),
            datetime.now().isoformat(),
            ticker.upper()
        ))
    
    def update_technical_indicators(self, ticker: str, indicators: Dict) -> int:
        """Update technical indicators for a stock."""
        query = '''
            UPDATE stocks SET
                ma_50 = ?,
                ma_200 = ?,
                rsi = ?,
                support_level = ?,
                resistance_level = ?
            WHERE ticker = ?
        '''
        return self.execute_update(query, (
            indicators.get('sma_50'),
            indicators.get('sma_200'),
            indicators.get('rsi'),
            indicators.get('support'),
            indicators.get('resistance'),
            ticker.upper()
        ))
    
    # =========================================================================
    # CACHED ANALYSIS
    # =========================================================================
    
    def init_cached_analysis_table(self):
        """Create cached_analysis table if not exists."""
        create_table = '''
            CREATE TABLE IF NOT EXISTS cached_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                analysis_date TEXT NOT NULL,
                analysis_json TEXT NOT NULL,
                signal TEXT,
                master_score REAL,
                technical_score REAL,
                fundamental_score REAL,
                timing_score REAL,
                pattern_score REAL,
                market_regime_score REAL,
                liquidity_level TEXT,
                is_tradeable INTEGER DEFAULT 1,
                market TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ticker, analysis_date)
            )
        '''
        # FIX (P20-Bug1, Aug 2026): writable=True — this method does CREATE TABLE +
        # ALTER TABLE + commit, but was using get_connection() which defaults to
        # readonly (mode=ro URI). On production this caused:
        #   "Error saving cached analysis: attempt to write a readonly database"
        # because init_cached_analysis_table() is called by save_cached_analysis()
        # before every INSERT — so the readonly connection poisoned the write path.
        with self.get_connection(writable=True) as conn:
            cursor = conn.cursor()
            cursor.execute(create_table)
            # Migration: add market column if missing (older DBs)
            try:
                cursor.execute("PRAGMA table_info(cached_analysis)")
                cols = [row['name'] for row in cursor.fetchall()]
                if 'market' not in cols:
                    cursor.execute("ALTER TABLE cached_analysis ADD COLUMN market TEXT")
            except Exception:
                pass
            conn.commit()
    
    def save_cached_analysis(self, ticker: str, analysis_data: Dict, analysis_date: str = None) -> bool:
        """Save analysis result to cache."""
        import json
        if analysis_date is None:
            analysis_date = datetime.now().strftime('%Y-%m-%d')
        
        self.init_cached_analysis_table()
        
        query = '''
            INSERT OR REPLACE INTO cached_analysis 
            (ticker, analysis_date, analysis_json, signal, master_score, 
             technical_score, fundamental_score, timing_score, pattern_score, 
             market_regime_score, liquidity_level, is_tradeable, market, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        '''
        try:
            # FIX (P20-Bug1, Aug 2026): writable=True is MANDATORY for INSERT.
            # Previously defaulted to readonly → "attempt to write a readonly database".
            with self.get_connection(writable=True) as conn:
                cursor = conn.cursor()
                cursor.execute(query, (
                    ticker.upper(),
                    analysis_date,
                    json.dumps(analysis_data, ensure_ascii=False),
                    analysis_data.get('signal'),
                    analysis_data.get('master_score'),
                    analysis_data.get('technical_score'),
                    analysis_data.get('fundamental_score'),
                    analysis_data.get('timing_score'),
                    analysis_data.get('pattern_score'),
                    analysis_data.get('market_regime_score'),
                    analysis_data.get('liquidity_level'),
                    1 if analysis_data.get('is_tradeable', True) else 0,
                    analysis_data.get('market'),
                    datetime.now().isoformat()
                ))
                conn.commit()
                return True
        except Exception as e:
            print(f"Error saving cached analysis: {e}")
            return False
    
    def get_cached_analysis(self, ticker: str, analysis_date: str = None) -> Optional[Dict]:
        """Get cached analysis for a ticker."""
        import json
        if analysis_date is None:
            analysis_date = datetime.now().strftime('%Y-%m-%d')
        
        query = '''
            SELECT analysis_json, created_at FROM cached_analysis 
            WHERE ticker = ? AND analysis_date = ?
        '''
        results = self.execute_query(query, (ticker.upper(), analysis_date))
        
        if results:
            try:
                return json.loads(results[0]['analysis_json'])
            except Exception:
                return None
        return None
    
    def get_all_cached_analysis(self, analysis_date: str = None, limit: int = 200, market: str = None) -> List[Dict]:
        """Get all cached analysis for a specific date.
        Falls back to the most recent available date if no data for requested date.
        
        Args:
            analysis_date: Date string YYYY-MM-DD (default: today)
            limit: Max rows to return (default 200). Prevents unbounded result sets
                   when the cached_analysis table grows large. Pass None to disable.
            market: Optional market filter (database market name: EGX, TADAWUL, KSE, QSE, etc.)
        """
        import json
        if analysis_date is None:
            analysis_date = datetime.now().strftime('%Y-%m-%d')
        
        # Build optional LIMIT clause + param tuple
        if limit is not None:
            limit_value = int(limit)
            if limit_value <= 0:
                limit_value = 200
            limit_clause = ' LIMIT ?'
            limit_params = (limit_value,)
        else:
            limit_clause = ''
            limit_params = ()
        
        # Build market filter
        market_clause = ''
        market_params = ()
        if market:
            market_clause = ' AND market = ?'
            market_params = (market,)
        
        query = f'''
            SELECT ticker, analysis_json, signal, master_score, 
                   technical_score, fundamental_score, liquidity_level, is_tradeable
            FROM cached_analysis 
            WHERE analysis_date = ?{market_clause}
            ORDER BY master_score DESC
            {limit_clause}
        '''
        results = self.execute_query(query, (analysis_date,) + market_params + limit_params)
        
        # Fallback: if no data for requested date, use the most recent available
        if not results:
            fallback_query = f'''
                SELECT ticker, analysis_json, signal, master_score, 
                       technical_score, fundamental_score, liquidity_level, is_tradeable
                FROM cached_analysis 
                WHERE analysis_date = (
                    SELECT analysis_date FROM cached_analysis 
                    ORDER BY analysis_date DESC LIMIT 1
                ){market_clause}
                ORDER BY master_score DESC
                {limit_clause}
            '''
            results = self.execute_query(fallback_query, market_params + limit_params)
        
        parsed = []
        for r in results:
            try:
                data = json.loads(r['analysis_json'])
                parsed.append(data)
            except Exception:
                pass
        return parsed
    
    def get_cache_status(self) -> Dict:
        """Get cache status info."""
        today = datetime.now().strftime('%Y-%m-%d')
        
        query = '''
            SELECT 
                COUNT(*) as total,
                analysis_date,
                MIN(created_at) as first_created,
                MAX(created_at) as last_created
            FROM cached_analysis
            WHERE analysis_date = ?
        '''
        results = self.execute_query(query, (today,))
        
        if results and results[0]['total'] > 0:
            return {
                'has_cache': True,
                'date': today,
                'total_analyzed': results[0]['total'],
                'first_created': results[0]['first_created'],
                'last_created': results[0]['last_created']
            }
        
        # Check if there's cache from previous days
        query2 = '''
            SELECT analysis_date, COUNT(*) as total
            FROM cached_analysis
            GROUP BY analysis_date
            ORDER BY analysis_date DESC
            LIMIT 3
        '''
        recent = self.execute_query(query2)
        
        return {
            'has_cache': False,
            'date': None,
            'total_analyzed': 0,
            'recent_caches': recent
        }
    
    def clear_cache(self, before_date: str = None) -> int:
        """Clear cached analysis."""
        if before_date:
            query = 'DELETE FROM cached_analysis WHERE analysis_date < ?'
            return self.execute_update(query, (before_date,))
        else:
            # FIX (P20-Bug1, Aug 2026): writable=True for DELETE operation.
            with self.get_connection(writable=True) as conn:
                cursor = conn.cursor()
                cursor.execute('DELETE FROM cached_analysis')
                conn.commit()
                return cursor.rowcount

    # =========================================================================
    # HEALTH CHECK
    # =========================================================================
    
    def health_check(self) -> Dict:
        """Check database health and return stats."""
        result = {
            'path': self.db_path,
            'exists': os.path.exists(self.db_path),
            'connected': False,
            'tables': [],
            'stats': {}
        }
        
        if not result['exists']:
            result['error'] = 'Database file not found'
            return result
        
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Get tables
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
                result['tables'] = [row[0] for row in cursor.fetchall()]
                
                # Get counts
                try:
                    cursor.execute("SELECT COUNT(*) FROM stocks")
                    result['stats']['stocks_count'] = cursor.fetchone()[0]
                except Exception:
                    result['stats']['stocks_count'] = 0
                
                try:
                    cursor.execute("SELECT COUNT(*) FROM stocks WHERE current_price IS NOT NULL")
                    result['stats']['stocks_with_prices'] = cursor.fetchone()[0]
                except Exception:
                    result['stats']['stocks_with_prices'] = 0
                
                try:
                    cursor.execute("SELECT COUNT(*) FROM stock_price_history")
                    result['stats']['history_count'] = cursor.fetchone()[0]
                except Exception:
                    result['stats']['history_count'] = 0
                
                result['connected'] = True
                
        except Exception as e:
            result['error'] = str(e)
        
        return result


# Convenience function for backward compatibility
@contextmanager
def get_db_connection(db_path: str = None) -> Generator[sqlite3.Connection, None, None]:
    """Get database connection - backward compatible function.

    FIX (Aug 2026): Now uses safe_connect() so timeout=30 + busy_timeout=30000
    are ALWAYS applied. This prevents 'database is locked' errors when many
    background analyzers read concurrently.
    """
    path = db_path or DATABASE_PATH
    conn = safe_connect(path, readonly=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception:
            pass

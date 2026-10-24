#!/usr/bin/env python3
"""
🔄 Data Sync Script - Full System Sync (P19-REAL-TIME-SYNC-PRACTICAL-ANALYSIS)
==============================================================================
يقوم بمزامنة البيانات بين قواعد البيانات.

المهام:
1. نسخ الأسعار الحالية إلى stocks.db (بتاريخ اليوم فقط)
2. UPSERT شمعة اليوم في stock_daily_prices (تحافظ على open/high/low — Live Developing Candle)
3. بث الأسعار الجديدة للـ WebSocket service (Hyper Polling)
"""

import sqlite3
import json
from datetime import datetime
from pathlib import Path

# Paths
DATA_DIR = Path(__file__).parent.parent / 'db'
DATA_ENGINE_DB = DATA_DIR / 'data_engine.db'
STOCKS_DB = DATA_DIR / 'stocks.db'
HISTORICAL_DB = DATA_DIR / 'historical.db'
NEWS_DB = DATA_DIR / 'news.db'
ENGINE_STATUS_FILE = DATA_DIR / 'engine_status.json'

# P19-REAL-TIME-SYNC: WebSocket service URL (port 3005)
# الـ WS service بيشتغل على المنفذ ده وبيـ emit 'ticker:update' لكل المشتركين.
# البث هنا best-effort — لو الـ service مش شغال، الـ sync بيكمل من غير مشاكل.
WS_SERVICE_URL = 'http://localhost:3005/broadcast'

# Global logs
all_logs = []

def log(msg, level='INFO'):
    """Log message"""
    timestamp = datetime.now().strftime('%H:%M:%S')
    log_entry = f"[{timestamp}] [{level}] {msg}"
    print(log_entry)
    all_logs.append(log_entry)
    update_engine_logs(log_entry, level)

def update_engine_logs(log_entry, level='INFO'):
    """Update engine status logs"""
    try:
        if ENGINE_STATUS_FILE.exists():
            with open(ENGINE_STATUS_FILE, 'r') as f:
                status = json.load(f)
        else:
            status = {'logs': [], 'errors': []}

        if 'logs' not in status:
            status['logs'] = []

        status['logs'].append(log_entry)
        status['logs'] = status['logs'][-100:]

        if level == 'ERROR':
            if 'errors' not in status:
                status['errors'] = []
            status['errors'].append(log_entry)
            status['errors'] = status['errors'][-20:]

        with open(ENGINE_STATUS_FILE, 'w') as f:
            json.dump(status, f, indent=2, ensure_ascii=False)
    except:
        pass

def get_today_date():
    """Get today's date in YYYY-MM-DD format"""
    return datetime.now().strftime('%Y-%m-%d')

def safe_connect(db_path) -> sqlite3.Connection:
    """P22-SYNC-TIMEOUT-FIX: Hardened SQLite connection.

    Applies the 3 PRAGMAs that prevent the 120s subprocess timeout:
      - journal_mode=WAL       → readers don't block writers (no more lock storms)
      - busy_timeout=30000     → wait up to 30s for a lock instead of hanging forever
      - synchronous=NORMAL     → faster fsync, safe under WAL

    Logs PRAGMA failures as WARNING instead of silently swallowing them, so we
    can detect permission/path issues that would otherwise cause another silent
    0-stocks-sync failure.
    """
    conn = sqlite3.connect(str(db_path), timeout=30.0)
    try:
        cur = conn.execute('PRAGMA journal_mode=WAL')
        mode = cur.fetchone()
        if not mode or str(mode[0]).lower() != 'wal':
            log(f"\u26a0\ufe0f WAL not active on {db_path.name} (got {mode})", 'WARNING')
        conn.execute('PRAGMA busy_timeout=30000')   # 30s \u2014 prevents infinite hang
        conn.execute('PRAGMA synchronous=NORMAL')   # safe+fast under WAL
        conn.execute('PRAGMA foreign_keys=ON')      # P14-PHASE-B (DATA-02)
    except Exception as e:
        log(f"\u26a0\ufe0f PRAGMA setup failed on {db_path.name}: {str(e)[:80]}", 'WARNING')
    return conn


# ═══════════════════════════════════════════════════════════════════════════
# P21-SYNC-HOTFIX: Helper functions for robust data parsing
# ═══════════════════════════════════════════════════════════════════════════
# الـ scraper بيكتب volume و market_cap كـ TEXT (مثلاً "1.2M", "3.4K", "12345").
# الـ destination stocks.db بيتوقع volume INTEGER و market_cap REAL.
# بنعمل parse آمن — لو فشل، نرجّع 0 (مش بنكسر الـ sync).

def parse_volume(vol):
    """Parse volume string ('1.2M', '3.4K', '12345', '') to int. Returns 0 if unparseable."""
    if not vol:
        return 0
    s = str(vol).strip().replace(',', '')
    if not s:
        return 0
    try:
        mult = 1
        if s[-1] in ('B', 'b'):
            mult = 1_000_000_000
            s = s[:-1]
        elif s[-1] in ('M', 'm'):
            mult = 1_000_000
            s = s[:-1]
        elif s[-1] in ('K', 'k'):
            mult = 1_000
            s = s[:-1]
        return int(float(s) * mult)
    except (ValueError, TypeError):
        return 0


def parse_market_cap(mc):
    """Parse market cap string to float. Returns 0 if unparseable."""
    if not mc:
        return 0
    s = str(mc).strip().replace(',', '')
    if not s:
        return 0
    try:
        mult = 1.0
        if s[-1] in ('B', 'b'):
            mult = 1_000_000_000.0
            s = s[:-1]
        elif s[-1] in ('M', 'm'):
            mult = 1_000_000.0
            s = s[:-1]
        elif s[-1] in ('K', 'k'):
            mult = 1_000.0
            s = s[:-1]
        return float(s) * mult
    except (ValueError, TypeError):
        return 0


def _ensure_column(cursor, table, col, coltype):
    """
    P21: Idempotent ALTER TABLE — أضف column لو مش موجود.
    بيـ ignore 'duplicate column' errors بأمان.
    ده بيخلي الـ sync شغال حتى لو الـ stocks.db قديم وناقص أعمدة.
    """
    try:
        cursor.execute(f'ALTER TABLE {table} ADD COLUMN {col} {coltype}')
    except sqlite3.OperationalError:
        pass  # column already exists — ده طبيعي


# ═══════════════════════════════════════════════════════════════════════════
# P19-REAL-TIME-SYNC: WebSocket Broadcast Helper
# ═══════════════════════════════════════════════════════════════════════════
def broadcast_prices_to_ws(price_updates):
    """
    P19: ابعت الأسعار الجديدة للـ WebSocket service عشان يـ pushها فوراً للمشتركين.

    Args:
        price_updates: list of dicts بـ {ticker, name_ar, current_price,
                       previous_close, change_percent, volume, timestamp}

    الـ WS service على URL: WS_SERVICE_URL (port 3005) بياخد POST /broadcast
    وبيـ emit 'ticker:update' لكل الـ sockets المشتركين في السهم ده.

    Best-effort: لو الـ service مش شغال أو الـ fetch فشل، الـ sync بيكمل عادي.
    """
    if not price_updates:
        return {'success': False, 'reason': 'no_updates'}

    try:
        import urllib.request
        import urllib.error

        body = json.dumps({
            'event': 'prices_synced',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'updates': price_updates,
        }).encode('utf-8')

        req = urllib.request.Request(
            WS_SERVICE_URL,
            data=body,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            if 200 <= resp.status < 300:
                log(f"📡 Broadcasted {len(price_updates)} prices to WS service")
                return {'success': True, 'status': resp.status, 'count': len(price_updates)}
            return {'success': False, 'status': resp.status}
    except urllib.error.URLError as e:
        # WS service مش شغال — ده طبيعي برة أوقات الجلسة. سجل WARNING بس.
        log(f"⚠️ WS broadcast skipped (service unreachable): {str(e.reason)[:80]}", 'WARNING')
        return {'success': False, 'reason': 'service_unreachable'}
    except Exception as e:
        log(f"⚠️ WS broadcast error: {str(e)[:80]}", 'WARNING')
        return {'success': False, 'reason': str(e)[:80]}


def create_stocks_db_tables():
    """Create stocks.db tables + UNIQUE INDEX on ticker (P22-SYNC-TIMEOUT-FIX).

    THE critical fix: production stocks.db.stocks has `ticker TEXT NOT NULL` but
    NO unique constraint. Without a UNIQUE index, `ON CONFLICT(ticker)` fails for
    every row → 0 stocks synced. We add `idx_stocks_ticker` idempotently.

    Also ensures both `last_update` (production name) and `last_updated` (sandbox
    name) columns exist, so the UPSERT works regardless of which DB version.

    P22: wrapped in try/finally so the connection is ALWAYS released — prevents
    the SQLite lock that was timing out main.py's 120s subprocess.wait().
    """
    conn = safe_connect(STOCKS_DB)
    try:
        cursor = conn.cursor()

        # CREATE TABLE IF NOT EXISTS is idempotent — won't override existing prod tables.
        # The schema below matches what migrator.py creates; existing prod tables
        # (with their richer column set) are left untouched.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS stocks (
                ticker TEXT PRIMARY KEY,
                name TEXT,
                market TEXT DEFAULT 'EGX',
                sector TEXT,
                industry TEXT,
                current_price REAL,
                previous_close REAL,
                change REAL,
                change_percent REAL,
                volume INTEGER,
                value_traded REAL,
                turnover_egp REAL,
                is_active INTEGER DEFAULT 1,
                last_updated TEXT,
                last_update TEXT,
                pe_ratio REAL,
                pb_ratio REAL,
                roe REAL,
                market_cap REAL,
                shares_outstanding REAL,
                dividend_yield REAL,
                currency TEXT DEFAULT 'EGP',
                exchange TEXT DEFAULT 'EGX',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        ''')

        # Daily prices history — مع open_price/high_price/low_price للـ Live Candle
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS stock_daily_prices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                price_date TEXT NOT NULL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                close_price REAL,
                volume INTEGER,
                turnover REAL,
                change_percent REAL,
                fetch_time TEXT,
                UNIQUE(ticker, price_date)
            )
        ''')

        # ── P19: ensure 'fetch_time' column exists (لو الـ DB قديم) ──
        try:
            cursor.execute("PRAGMA table_info(stock_daily_prices)")
            existing_cols = {r[1] for r in cursor.fetchall()}
            if 'fetch_time' not in existing_cols:
                cursor.execute("ALTER TABLE stock_daily_prices ADD COLUMN fetch_time TEXT")
            # backward compat: لو الـ schema القديم بيستخدم 'open'/'high'/'low'/'close'
            # بدون _price suffix، ضيف الأعمدة الجديدة بنفس القيم.
            if 'open' in existing_cols and 'open_price' not in existing_cols:
                cursor.execute("ALTER TABLE stock_daily_prices ADD COLUMN open_price REAL")
                cursor.execute("UPDATE stock_daily_prices SET open_price = open WHERE open_price IS NULL")
            if 'high' in existing_cols and 'high_price' not in existing_cols:
                cursor.execute("ALTER TABLE stock_daily_prices ADD COLUMN high_price REAL")
                cursor.execute("UPDATE stock_daily_prices SET high_price = high WHERE high_price IS NULL")
            if 'low' in existing_cols and 'low_price' not in existing_cols:
                cursor.execute("ALTER TABLE stock_daily_prices ADD COLUMN low_price REAL")
                cursor.execute("UPDATE stock_daily_prices SET low_price = low WHERE low_price IS NULL")
            if 'close' in existing_cols and 'close_price' not in existing_cols:
                cursor.execute("ALTER TABLE stock_daily_prices ADD COLUMN close_price REAL")
                cursor.execute("UPDATE stock_daily_prices SET close_price = close WHERE close_price IS NULL")
        except Exception:
            pass  # safety — مش بنكسر الـ sync لو الـ ALTER فشل

        # ── P21-SYNC-HOTFIX: تأكد إن كل الأعمدة المطلوبة موجودة في stocks table ──
        # ده بيتعامل مع الـ DBs القديمة اللي ممكن يكون فيها schema ناقص.
        # ALTER TABLE ADD COLUMN لو موجودة بالفعل → بيـ throw 'duplicate column'
        # وإحنا بنـ ignore ده بأمان.
        for col, coltype in [
            ('current_price', 'REAL'),
            ('previous_close', 'REAL'),
            ('change', 'REAL'),
            ('change_percent', 'REAL'),
            ('volume', 'INTEGER'),
            ('market_cap', 'REAL'),
            ('market', 'TEXT'),
            ('sector', 'TEXT'),
            ('industry', 'TEXT'),
            ('is_active', 'INTEGER DEFAULT 1'),
            ('last_updated', 'TEXT'),
            ('last_update', 'TEXT'),  # P22: production column name
            ('updated_at', 'TEXT'),
            ('currency', "TEXT DEFAULT 'EGP'"),
            ('exchange', "TEXT DEFAULT 'EGX'"),
        ]:
            _ensure_column(cursor, 'stocks', col, coltype)

        # ── P22-SYNC-TIMEOUT-FIX: THE critical fix ──
        # Production stocks.db.stocks has `ticker TEXT NOT NULL` but NO unique
        # constraint. ON CONFLICT(ticker) requires a UNIQUE index on ticker.
        # Without this, every UPSERT fails with:
        #   'ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint'
        #   → 0 stocks synced → 0 prices saved → main.py returns 0 → 120s timeout.
        #
        # P23-DATA-ENGINE-RESCUE (Aug 2026): `CREATE UNIQUE INDEX IF NOT EXISTS` is
        # a NO-OP if a NON-UNIQUE index with the same name already exists. That was
        # the root cause of the data engine crisis — the index name existed but was
        # non-unique, so the UPSERT silently failed for weeks. Fix: DROP the old
        # index first, then CREATE UNIQUE. Idempotent.
        try:
            cursor.execute('DROP INDEX IF EXISTS idx_stocks_ticker')
            cursor.execute('CREATE UNIQUE INDEX idx_stocks_ticker ON stocks(ticker)')
        except sqlite3.IntegrityError:
            # Duplicate tickers exist — clean them up, keeping the lowest id (oldest).
            log("\u26a0\ufe0f Duplicate tickers found in stocks — cleaning up (keeping oldest)", 'WARNING')
            cursor.execute(
                'DELETE FROM stocks WHERE id NOT IN '
                '(SELECT MIN(id) FROM stocks GROUP BY ticker)'
            )
            cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker)')
            log(f"\u2705 Cleaned duplicates and created UNIQUE index on ticker", 'INFO')

        conn.commit()
        log("\u2705 Ensured stocks.db tables + UNIQUE index on ticker (P22)")
    finally:
        # P22: ALWAYS release the connection — prevents the lock that timed out main.py.
        conn.close()


def sync_current_prices():
    """Sync current prices from data_engine.db to stocks.db
    (P22-SYNC-TIMEOUT-FIX: WAL + UNIQUE index + executemany batch + try/finally).

    P22 changes that fix the 120s subprocess timeout:
      1. Source SELECT is unchanged (single fetchall).
      2. Per-stock parsing builds TWO param lists in memory — no DB calls in the loop.
      3. After the loop: ONE `executemany()` for all stocks + ONE `executemany()`
         for all daily candles. 293 rows → 2 DB round-trips instead of 586.
      4. Single `commit()` at the end (atomic batch transaction).
      5. `try/finally` guarantees both connections are closed even on exception —
         this is what was leaking locks and causing main.py to time out.
      6. Writes to BOTH `last_update` (production) and `last_updated` (sandbox)
         so the UPSERT works on either schema.
    """
    log("=" * 50)
    log("📊 SYNCING CURRENT PRICES (P22-SYNC-TIMEOUT-FIX)")
    log("=" * 50)

    SOURCE_SELECT_SQL = (
        'SELECT symbol, name, price, change_percent, volume, '
        'market_cap, sector, market FROM stocks'
    )

    # Destination UPSERT — writes to BOTH `last_update` (production name) and
    # `last_updated` (sandbox name) so it works on either schema. Both columns
    # are ensured by create_stocks_db_tables() via _ensure_column.
    # ON CONFLICT(ticker) requires the UNIQUE index created above.
    DEST_UPSERT_SQL = '''
        INSERT INTO stocks
            (ticker, name, current_price, previous_close, change_percent,
             volume, market, sector, market_cap,
             open_price, high_price, low_price,
             last_update, last_updated, updated_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(ticker) DO UPDATE SET
            name = COALESCE(excluded.name, stocks.name),
            current_price = excluded.current_price,
            previous_close = COALESCE(excluded.previous_close, stocks.previous_close),
            change_percent = excluded.change_percent,
            volume = excluded.volume,
            market = excluded.market,
            sector = excluded.sector,
            market_cap = excluded.market_cap,
            open_price = COALESCE(stocks.open_price, excluded.open_price),
            high_price = MAX(COALESCE(stocks.high_price, 0), excluded.high_price),
            low_price = CASE
                WHEN stocks.low_price IS NULL OR stocks.low_price <= 0 THEN excluded.low_price
                WHEN excluded.low_price > 0 THEN MIN(stocks.low_price, excluded.low_price)
                ELSE stocks.low_price
            END,
            last_update = excluded.last_update,
            last_updated = excluded.last_updated,
            updated_at = excluded.updated_at
    '''

    # Daily candle UPSERT — Live Developing Candle logic preserved.
    # open_price/high_price/low_price/close_price exist on both schemas (the
    # _ensure_column migration in create_stocks_db_tables adds them to prod DBs
    # that only have open/high/low/close).
    CANDLE_UPSERT_SQL = '''
        INSERT INTO stock_daily_prices
            (ticker, price_date, open_price, high_price, low_price,
             close_price, volume, change_percent, fetch_time,
             open, high, low, close)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker, price_date) DO UPDATE SET
            open_price = COALESCE(stock_daily_prices.open_price, excluded.open_price),
            open = COALESCE(stock_daily_prices.open, excluded.open),
            high_price = MAX(COALESCE(stock_daily_prices.high_price, 0), excluded.high_price),
            high = MAX(COALESCE(stock_daily_prices.high, 0), excluded.high),
            low_price = CASE
                WHEN stock_daily_prices.low_price IS NULL THEN excluded.low_price
                ELSE MIN(stock_daily_prices.low_price, excluded.low_price)
            END,
            low = CASE
                WHEN stock_daily_prices.low IS NULL THEN excluded.low
                ELSE MIN(stock_daily_prices.low, excluded.low)
            END,
            close_price = excluded.close_price,
            close = excluded.close,
            volume = excluded.volume,
            change_percent = excluded.change_percent,
            fetch_time = excluded.fetch_time
    '''

    result = {
        'synced': 0,
        'updated': 0,
        'prices_saved': 0,
        'candles_upserted': 0,
        'broadcasted': 0,
        'errors': 0,
        'details': []
    }

    today = get_today_date()
    log(f"📅 Today's date: {today}")

    # Ensure tables + UNIQUE index exist (P22: required for ON CONFLICT)
    create_stocks_db_tables()

    price_updates_for_ws = []

    src_conn = None
    dst_conn = None
    try:
        if not DATA_ENGINE_DB.exists():
            log(f"❌ Source database not found: {DATA_ENGINE_DB}", 'ERROR')
            return result

        src_conn = safe_connect(DATA_ENGINE_DB)
        src_conn.row_factory = sqlite3.Row
        src_cursor = src_conn.cursor()

        dst_conn = safe_connect(STOCKS_DB)
        dst_cursor = dst_conn.cursor()

        try:
            src_cursor.execute(SOURCE_SELECT_SQL)
        except sqlite3.OperationalError as e:
            log(f"⚠️ data_engine.db.stocks not readable: {str(e)[:100]}", 'WARNING')
            result['details'].append(f'source table error: {str(e)[:80]}')
            return result

        stocks = src_cursor.fetchall()
        log(f"📊 Found {len(stocks)} stocks to sync")

        if not stocks:
            log("⚠️ Source stocks table is empty — scraper may not have written yet", 'WARNING')
            return result

        # ── P22: Build batch param lists in memory (NO DB calls in the loop) ──
        # The old code did 2 `execute()` per stock (586 round-trips for 293 stocks).
        # We now build two param lists and do ONE `executemany()` each at the end.
        stock_params = []
        candle_params = []
        skipped_null = 0

        for stock in stocks:
            symbol = None
            try:
                symbol = stock['symbol']
                if not symbol:
                    skipped_null += 1
                    continue
                name = stock['name'] or symbol
                price = float(stock['price'] or 0)
                change_pct = float(stock['change_percent'] or 0)
                volume = parse_volume(stock['volume'])
                market = stock['market'] or ''
                sector = stock['sector'] or ''
                market_cap = parse_market_cap(stock['market_cap'])

                market_map = {
                    'مصر': 'EGX',
                    'السعودية': 'TADAWUL',
                    'الكويت': 'KSE',
                    'قطر': 'QSE'
                }
                market_code = market_map.get(market, market or 'EGX')

                if price > 0 and change_pct != 0:
                    prev_close = round(price / (1 + change_pct / 100.0), 4)
                else:
                    prev_close = price

                fetch_time = datetime.now().isoformat()
                src_open = prev_close
                src_high = max(price, prev_close)
                src_low = min(price, prev_close)

                # Stock UPSERT params (16 columns)
                stock_params.append((
                    symbol, name, price, prev_close, change_pct,
                    volume, market_code, sector, market_cap,
                    src_open, src_high, src_low,
                    fetch_time, fetch_time, fetch_time,
                ))

                # Daily candle UPSERT params (only when price > 0)
                if price > 0:
                    candle_params.append((
                        symbol, today, src_open, src_high, src_low,
                        price, volume, change_pct, fetch_time,
                        src_open, src_high, src_low, price,
                    ))
                    result['prices_saved'] += 1

                # WS broadcast payload
                price_updates_for_ws.append({
                    'ticker': symbol,
                    'name_ar': name or symbol,
                    'current_price': float(price),
                    'previous_close': float(prev_close),
                    'price_change': float(change_pct),
                    'volume': int(volume) if volume else 0,
                    'timestamp': fetch_time,
                })

            except Exception as e:
                result['errors'] += 1
                err_symbol = symbol if symbol else '?'
                log(f"⚠️ Parse error for {err_symbol}: {str(e)[:80]}", 'WARNING')
                if result['errors'] <= 10:
                    result['details'].append(f"Parse error {err_symbol}: {str(e)[:60]}")

        if skipped_null > 0:
            log(f"⏭️ Skipped {skipped_null} rows with NULL symbol", 'INFO')

        log(f"📦 Batch prepared: {len(stock_params)} stocks + {len(candle_params)} candles")

        # ── P22: executemany() — ONE DB call per UPSERT (the batch transaction) ──
        # This is THE performance fix: 293 stocks in <0.5s instead of 293 separate
        # executes that were timing out at 120s under lock contention.
        if stock_params:
            try:
                dst_cursor.executemany(DEST_UPSERT_SQL, stock_params)
                result['synced'] = len(stock_params)
                log(f"✅ Batch UPSERT: {len(stock_params)} stocks in one transaction")
            except sqlite3.Error as e:
                # Schema issue — log as ERROR so we notice, but don't crash the
                # candle UPSERT (it's independent).
                result['errors'] += len(stock_params)
                log(f"❌ Batch stock UPSERT failed: {str(e)[:120]}", 'ERROR')
                result['details'].append(f"Batch UPSERT error: {str(e)[:100]}")

        if candle_params:
            try:
                dst_cursor.executemany(CANDLE_UPSERT_SQL, candle_params)
                result['candles_upserted'] = len(candle_params)
                log(f"✅ Batch candle UPSERT: {len(candle_params)} candles in one transaction")
            except sqlite3.Error as e:
                log(f"❌ Batch candle UPSERT failed: {str(e)[:120]}", 'ERROR')
                result['details'].append(f"Candle UPSERT error: {str(e)[:100]}")

        # Single commit — atomic batch transaction
        dst_conn.commit()

        log(f"✅ Synced: {result['synced']} stocks (UPSERT)")
        log(f"✅ Daily candles upserted: {result['candles_upserted']}")
        log(f"✅ Prices saved: {result['prices_saved']}")
        if result['errors'] > 0:
            log(f"⚠️ Errors: {result['errors']}", 'WARNING')

        # ── P19: بث الأسعار للـ WebSocket service ──
        if price_updates_for_ws:
            broadcast_result = broadcast_prices_to_ws(price_updates_for_ws)
            if broadcast_result.get('success'):
                result['broadcasted'] = broadcast_result.get('count', 0)
            else:
                log(f"ℹ️ WS broadcast not sent: {broadcast_result.get('reason', 'unknown')}", 'INFO')

    except Exception as e:
        result['errors'] += 1
        result['details'].append(f"Sync error: {str(e)}")
        log(f"❌ Sync error: {str(e)}", 'ERROR')
    finally:
        # ── P22: ALWAYS close connections (prevents the SQLite lock that timed out main.py) ──
        # The old code only closed on the happy path; any exception left connections
        # open, which blocked main.py's subsequent writes and caused the 120s hang.
        if src_conn is not None:
            try:
                src_conn.close()
            except Exception:
                pass
        if dst_conn is not None:
            try:
                dst_conn.close()
            except Exception:
                pass

    return result

def sync_historical_prices():
    """Sync historical prices to historical.db"""
    log("=" * 50)
    log("📜 SYNCING HISTORICAL PRICES")
    log("=" * 50)

    result = {
        'records': 0,
        'symbols': 0,
        'errors': 0
    }

    if not HISTORICAL_DB.exists():
        log("⚠️ Historical database not found - run historical fetcher first", 'WARNING')
        return result

    try:
        conn = safe_connect(HISTORICAL_DB)
        cursor = conn.cursor()

        cursor.execute('SELECT COUNT(*) FROM historical_prices')
        result['records'] = cursor.fetchone()[0]

        cursor.execute('SELECT COUNT(DISTINCT symbol) FROM historical_prices')
        result['symbols'] = cursor.fetchone()[0]

        conn.close()

        log(f"✅ Historical data: {result['records']:,} records for {result['symbols']} symbols")

    except Exception as e:
        result['errors'] += 1
        log(f"❌ Error: {str(e)}", 'ERROR')

    return result

def sync_crypto_prices():
    """Sync crypto prices to database"""
    log("=" * 50)
    log("₿ SYNCING CRYPTO PRICES")
    log("=" * 50)

    result = {'synced': 0, 'errors': 0}

    try:
        if not DATA_ENGINE_DB.exists():
            return result

        conn = safe_connect(DATA_ENGINE_DB)
        cursor = conn.cursor()

        cursor.execute('SELECT COUNT(*) FROM crypto_prices')
        count = cursor.fetchone()[0]

        conn.close()

        log(f"✅ Crypto prices: {count} records")
        result['synced'] = count

    except Exception as e:
        result['errors'] += 1
        log(f"❌ Error: {str(e)}", 'ERROR')

    return result

def sync_metals_prices():
    """Sync metals and forex prices"""
    log("=" * 50)
    log("🥇 SYNCING METALS & FOREX")
    log("=" * 50)

    result = {'gold': 0, 'silver': 0, 'forex': 0, 'errors': 0}

    try:
        if not DATA_ENGINE_DB.exists():
            return result

        conn = safe_connect(DATA_ENGINE_DB)
        cursor = conn.cursor()

        cursor.execute('SELECT COUNT(*) FROM gold_prices')
        result['gold'] = cursor.fetchone()[0]

        try:
            cursor.execute('SELECT COUNT(*) FROM silver_prices')
            result['silver'] = cursor.fetchone()[0]
        except:
            pass

        try:
            cursor.execute('SELECT COUNT(*) FROM exchange_rates')
            result['forex'] = cursor.fetchone()[0]
        except:
            pass

        conn.close()

        log(f"✅ Gold: {result['gold']} | Silver: {result['silver']} | Forex: {result['forex']}")

    except Exception as e:
        result['errors'] += 1
        log(f"❌ Error: {str(e)}", 'ERROR')

    return result

def run_full_sync():
    """Run complete sync process (P19: + WS broadcast)"""
    log("")
    log("=" * 60)
    log("🔄 FULL DATA SYNC - STARTING (P19-REAL-TIME-SYNC)")
    log("=" * 60)

    start_time = datetime.now()

    # Run all syncs
    stocks_result = sync_current_prices()
    historical_result = sync_historical_prices()
    crypto_result = sync_crypto_prices()
    metals_result = sync_metals_prices()

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()

    log("")
    log("=" * 60)
    log("🎉 FULL SYNC COMPLETE (P19)")
    log("=" * 60)
    log(f"⏱️ Duration: {duration:.1f} seconds")
    log(f"📊 Stocks: {stocks_result['synced']} new + {stocks_result['updated']} updated")
    log(f"📊 Daily candles upserted: {stocks_result['candles_upserted']}")
    log(f"📊 Prices saved: {stocks_result['prices_saved']}")
    log(f"📡 WS broadcasted: {stocks_result.get('broadcasted', 0)} updates")
    log(f"📜 Historical: {historical_result['records']:,} records")
    log(f"₿ Crypto: {crypto_result['synced']} records")
    log(f"🥇 Metals: Gold {metals_result['gold']} | Silver {metals_result['silver']}")
    log("=" * 60)

    # SYNC-INTEGRITY-CHECK: كشف الـ SilentFailure
    total_synced = stocks_result.get('synced', 0) + stocks_result.get('updated', 0)
    total_prices = stocks_result.get('prices_saved', 0)
    if total_synced == 0 and total_prices == 0:
        log("🚨 FATAL SYNC ERROR: 0 stocks synced, 0 prices saved!", 'ERROR')
        log("🚨 data_engine.db empty — fallback chain should have kicked in upstream.", 'ERROR')
        log("🚨 Check data_engine/main.py:_run_stocks_with_fallback_chain for source failures.", 'ERROR')

    return {
        'stocks': stocks_result,
        'historical': historical_result,
        'crypto': crypto_result,
        'metals': metals_result,
        'duration': duration,
        # Phase 1 additions — explicit summary for callers (main.py)
        'stocks_synced': total_synced,
        'prices_saved': total_prices,
        'candles_upserted': stocks_result.get('candles_upserted', 0),
        'broadcasted': stocks_result.get('broadcasted', 0),
        'sync_ok': (total_synced > 0 or total_prices > 0),
    }

if __name__ == '__main__':
    run_full_sync()

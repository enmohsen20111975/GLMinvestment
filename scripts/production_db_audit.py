#!/usr/bin/env python3
"""
production_db_audit.py — Production VPS Database Forensic Audit
================================================================
سكربت read-only يجمع وصف تفصيلي للوضع على السيرفر الإنتاجي.
لا يكتب، لا يحذف، لا يعدّل أي شيء. كل العمليات SELECT أو PRAGMA أو ls.

الاستخدام (على الـ VPS):
    cd /root/GLMinvestment
    python3 production_db_audit.py > /tmp/db_audit_$(date +%Y%m%d_%H%M%S).txt 2>&1
    cat /tmp/db_audit_*.txt | head -200  # للمراجعة

أو مباشرة:
    python3 production_db_audit.py

المخرجات:
    - معلومات Git + PM2 + cron
    - كل ملفات DB + أحجامها + تواريخ التعديل + WAL/SHM
    - كل tables + schemas + indexes + constraints
    - عدّاد الصفوف لكل table
    - التكرارات في radar_signal_tracking (3 مفاتيح)
    - canonical_state distribution
    - مسارات DBs الفعلية + env overrides
    - أسوأ الاستعلامات (slow queries potential)

ممنوع:
    - أي DELETE / UPDATE / INSERT
    - أي schema migration
    - أي إعادة تشغيل خدمات

السكربت آمن مع WAL (يستخدم mode=ro URI).
"""
from __future__ import annotations

import os
import sys
import sqlite3
import subprocess
import json
from pathlib import Path
from datetime import datetime

# ═══════════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════════

# ابحث عن مجلد db/ في أكثر من مكان محتمل
CANDIDATE_DB_DIRS = [
    Path('/root/GLMinvestment/db'),
    Path('/home/z/my-project/db'),  # sandbox fallback
    Path.cwd() / 'db',
]

# DBs اللي هنفحصها (كلها)
DB_NAMES_TO_AUDIT = [
    'stocks.db', 'predictions.db', 'price_history.db',
    'data_engine.db', 'intraday.db', 'news.db', 'auth.db',
    'crypto.db', 'custom.db', 'metrics.db',
    # محتملة على الإنتاج:
    'market.db', 'content.db', 'gold_prices.db', 'silver_prices.db',
    'analytics.db', 'community.db', 'learned.db', 'crypto_learning.db',
    'crypto-lab.db', 'exchange_rates.db', 'historical.db',
]

OUTPUT_WIDTH = 100


def banner(title: str):
    print()
    print('=' * OUTPUT_WIDTH)
    print(f'  {title}')
    print('=' * OUTPUT_WIDTH)


def sub_banner(title: str):
    print()
    print('-' * 80)
    print(f'  {title}')
    print('-' * 80)


def safe_run(cmd: list, cwd: str = None, timeout: int = 30) -> str:
    """Run a command safely, return stdout. Never raises."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            cwd=cwd, check=False,
        )
        return result.stdout + (f'\n[stderr] {result.stderr}' if result.stderr.strip() else '')
    except Exception as e:
        return f'[error: {e}]'


def find_db_dir() -> Path:
    """Find the actual db/ directory."""
    for candidate in CANDIDATE_DB_DIRS:
        try:
            if candidate.is_dir() and any(candidate.glob('*.db')):
                return candidate
        except (PermissionError, OSError):
            # Skip inaccessible dirs (e.g., /root/... on sandbox)
            continue
    # fallback
    return Path.cwd() / 'db'


def connect_ro(db_path: Path) -> sqlite3.Connection:
    """Connect read-only with WAL safety."""
    return sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=30)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1: System + Git + Services
# ═══════════════════════════════════════════════════════════════════════════

def audit_system_info():
    banner('SECTION 1: SYSTEM INFO')
    print(f'  Timestamp: {datetime.now().isoformat()}')
    print(f'  Hostname: {safe_run(["hostname"]).strip()}')
    print(f'  Pwd: {Path.cwd()}')
    print(f'  Python: {sys.version.split()[0]}')
    print(f'  User: {safe_run(["whoami"]).strip()}')
    print(f'  OS: {safe_run(["uname", "-a"]).strip()}')


def audit_git_state():
    banner('SECTION 2: GIT STATE')
    print('  --- git log -5 ---')
    print(safe_run(['git', 'log', '--oneline', '-5']))
    print('  --- git status ---')
    print(safe_run(['git', 'status', '-sb']))
    print('  --- git remote (REDACTED) ---')
    remote = safe_run(['git', 'remote', '-v'])
    # Hide credentials
    import re
    remote = re.sub(r'https://[^@]+@', 'https://[REDACTED]@', remote)
    print(remote)
    print('  --- git rev-parse HEAD + origin/main ---')
    print(f'  HEAD:        {safe_run(["git", "rev-parse", "HEAD"]).strip()}')
    print(f'  origin/main: {safe_run(["git", "rev-parse", "origin/main"]).strip()}')


def audit_pm2_services():
    banner('SECTION 3: PM2 SERVICES')
    print(safe_run(['pm2', 'list'], timeout=15))
    print()
    print('  --- pm2 jlist (json) ---')
    jlist = safe_run(['pm2', 'jlist'], timeout=15)
    try:
        services = json.loads(jlist)
        for svc in services:
            name = svc.get('name', '?')
            status = svc.get('pm2_env', {}).get('status', '?')
            restarts = svc.get('pm2_env', {}).get('restart_time', '?')
            cwd = svc.get('pm2_env', {}).get('pm_cwd', '?')
            script = svc.get('pm2_env', {}).get('pm_exec_path', '?')
            print(f'  {name:25s} status={status:10s} restarts={restarts} cwd={cwd}')
    except Exception:
        print(jlist[:500])


def audit_cron_jobs():
    banner('SECTION 4: CRON JOBS')
    print('  --- crontab -l ---')
    print(safe_run(['crontab', '-l']))
    print('  --- /etc/cron.d/ ---')
    print(safe_run(['ls', '-la', '/etc/cron.d/']))
    print('  --- /etc/cron.daily/ ---')
    print(safe_run(['ls', '-la', '/etc/cron.daily/']))


def audit_env_vars():
    banner('SECTION 5: ENVIRONMENT VARIABLES (DB-related only)')
    db_env_keys = [
        'DB_DIR', 'STOCKS_DB', 'PREDICTIONS_DB', 'PRICE_HISTORY_DB',
        'DATA_ENGINE_DB', 'INTRADAY_DB', 'NEWS_DB', 'AUTH_DB',
        'MARKET_DB', 'CONTENT_DB', 'CRYPTO_DB', 'DATABASE_URL',
        'CANONICAL_STATE_SHADOW_MODE', 'V40_2_BACKTEST_MODE',
        'EGXPY_SERVICE_URL', 'EGX_VPS_API_URL',
    ]
    for key in db_env_keys:
        val = os.environ.get(key, '<not set>')
        # Don't print secrets
        if any(s in key.upper() for s in ['SECRET', 'TOKEN', 'PASSWORD', 'KEY']):
            val = '<redacted>' if val != '<not set>' else val
        print(f'  {key:35s} = {val}')

    print()
    print('  --- .env file (keys only, values redacted) ---')
    env_file = Path.cwd() / '.env'
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                key, _, val = line.partition('=')
                # Redact values that look like secrets
                if any(s in key.upper() for s in ['SECRET', 'TOKEN', 'PASSWORD', 'KEY', 'URL']):
                    val = '<redacted>'
                print(f'  {key:35s} = {val[:60]}')
    else:
        print('  .env not found')


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2: Database files inventory
# ═══════════════════════════════════════════════════════════════════════════

def audit_db_files(db_dir: Path):
    banner('SECTION 6: DATABASE FILES INVENTORY')
    print(f'  DB dir: {db_dir}')
    print()
    print(f'  {"File":<35s} {"Size (MB)":>10s} {"Modified":<22s} {"WAL":>5s} {"SHM":>5s}')
    print('  ' + '-' * 80)

    db_files = sorted(db_dir.glob('*.db'))
    for db in db_files:
        sz = db.stat().st_size / 1e6
        mtime = datetime.fromtimestamp(db.stat().st_mtime).strftime('%Y-%m-%d %H:%M:%S')
        wal = db.parent / f'{db.name}-wal'
        shm = db.parent / f'{db.name}-shm'
        has_wal = '✓' if wal.exists() else '—'
        has_shm = '✓' if shm.exists() else '—'
        wal_sz = ''
        if wal.exists():
            wal_sz = f' ({wal.stat().st_size / 1e6:.1f}MB)'
        print(f'  {db.name:<35s} {sz:>10.2f} {mtime:<22s} {has_wal:>5s} {has_shm:>5s}{wal_sz}')


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3: Per-DB schema + tables + counts + indexes
# ═══════════════════════════════════════════════════════════════════════════

def audit_db_schema(db_path: Path):
    """Audit one DB: tables, counts, schemas, indexes, constraints."""
    banner(f'SECTION 7: {db_path.name} — SCHEMA + TABLES')

    if not db_path.exists():
        print(f'  [not found]')
        return

    try:
        conn = connect_ro(db_path)
    except Exception as e:
        print(f'  [connect error: {e}]')
        return

    # Journal mode
    try:
        jm = conn.execute('PRAGMA journal_mode').fetchone()[0]
        print(f'  Journal mode: {jm}')
    except Exception:
        pass

    # Tables
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()

    print(f'  Total tables: {len(tables)}')
    print()
    print(f'  {"Table":<40s} {"Rows":>10s} {"Idxs":>5s} {"Has UNIQUE":>12s}')
    print('  ' + '-' * 75)

    for (table_name,) in tables:
        try:
            count = conn.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0]
        except Exception as e:
            count = f'err: {str(e)[:20]}'

        # Indexes
        idxs = conn.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?",
            (table_name,)
        ).fetchall()

        # Check for UNIQUE constraints in table definition
        table_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,)
        ).fetchone()
        has_unique = '—'
        if table_sql and table_sql[0]:
            sql_lower = table_sql[0].lower()
            if 'unique' in sql_lower or 'primary key' in sql_lower:
                has_unique = '✓'

        print(f'  {table_name:<40s} {str(count):>10s} {len(idxs):>5d} {has_unique:>12s}')

    conn.close()


def audit_table_schema_detail(db_path: Path, table_name: str):
    """Detailed schema for one table (columns + indexes SQL)."""
    sub_banner(f'{db_path.name}.{table_name} — DETAILED SCHEMA')

    if not db_path.exists():
        print(f'  [db not found]')
        return

    try:
        conn = connect_ro(db_path)
    except Exception as e:
        print(f'  [connect error: {e}]')
        return

    # Table CREATE statement
    sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,)
    ).fetchone()
    if sql:
        print('  CREATE statement:')
        for line in sql[0].split('\n'):
            print(f'    {line}')
    print()

    # Indexes
    idxs = conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?",
        (table_name,)
    ).fetchall()
    if idxs:
        print('  Indexes:')
        for name, sql_text in idxs:
            print(f'    {name}:')
            print(f'      {sql_text}')
    else:
        print('  Indexes: (none)')
    print()

    # Columns
    cols = conn.execute(f'PRAGMA table_info("{table_name}")').fetchall()
    print('  Columns:')
    for col in cols:
        cid, name, ctype, notnull, default, pk = col
        print(f'    {name:<30s} {ctype:<15s} notnull={notnull} default={default} pk={pk}')

    conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4: radar_signal_tracking deep audit (the problematic table)
# ═══════════════════════════════════════════════════════════════════════════

def audit_radar_signal_tracking(db_path: Path):
    banner('SECTION 8: radar_signal_tracking DEEP AUDIT')

    if not db_path.exists():
        print(f'  [db not found]')
        return

    try:
        conn = connect_ro(db_path)
    except Exception as e:
        print(f'  [connect error: {e}]')
        return

    # Total count
    total = conn.execute('SELECT COUNT(*) FROM radar_signal_tracking').fetchone()[0]
    print(f'  Total rows: {total}')

    if total == 0:
        print('  [table empty — nothing to audit]')
        conn.close()
        return

    # signal_type distribution
    sub_banner('signal_type distribution')
    for r in conn.execute(
        'SELECT signal_type, COUNT(*) FROM radar_signal_tracking GROUP BY signal_type ORDER BY 2 DESC'
    ).fetchall():
        print(f'  {r[0] or "<NULL>":<35s} {r[1]:>8d}')

    # Date distribution (top 10)
    sub_banner('signal_date distribution (top 10)')
    for r in conn.execute(
        'SELECT signal_date, COUNT(*) FROM radar_signal_tracking GROUP BY signal_date ORDER BY 1 DESC LIMIT 10'
    ).fetchall():
        print(f'  {r[0]:<25s} {r[1]:>8d}')

    # canonical_state distribution
    sub_banner('canonical_state column distribution')
    try:
        for r in conn.execute(
            "SELECT canonical_state, COUNT(*) FROM radar_signal_tracking GROUP BY canonical_state ORDER BY 2 DESC"
        ).fetchall():
            print(f'  {r[0] or "<empty>":<30s} {r[1]:>8d}')
    except Exception as e:
        print(f'  [error: {e}]')

    # Duplicates by 3 keys
    sub_banner('DUPLICATES AUDIT')

    # Key 1: (ticker, signal_date)
    dups1 = conn.execute("""
        SELECT ticker, signal_date, COUNT(*) as cnt
        FROM radar_signal_tracking
        GROUP BY ticker, signal_date
        HAVING cnt > 1
        ORDER BY cnt DESC
        LIMIT 10
    """).fetchall()
    total_extra1 = conn.execute("""
        SELECT COALESCE(SUM(c), 0) FROM (
            SELECT COUNT(*) - 1 as c
            FROM radar_signal_tracking
            GROUP BY ticker, signal_date
            HAVING COUNT(*) > 1
        )
    """).fetchone()[0]
    print(f'  Key 1: (ticker, signal_date)')
    print(f'    Duplicate pairs: {len(dups1)}')
    print(f'    Extra rows: {total_extra1}')
    for r in dups1[:5]:
        print(f'    {r[0]:8s} {r[1]} ×{r[2]}')
    print()

    # Key 2: (ticker, signal_date, signal_type)
    dups2 = conn.execute("""
        SELECT ticker, signal_date, signal_type, COUNT(*) as cnt
        FROM radar_signal_tracking
        GROUP BY ticker, signal_date, signal_type
        HAVING cnt > 1
        ORDER BY cnt DESC
        LIMIT 10
    """).fetchall()
    total_extra2 = conn.execute("""
        SELECT COALESCE(SUM(c), 0) FROM (
            SELECT COUNT(*) - 1 as c
            FROM radar_signal_tracking
            GROUP BY ticker, signal_date, signal_type
            HAVING COUNT(*) > 1
        )
    """).fetchone()[0]
    print(f'  Key 2: (ticker, signal_date, signal_type)')
    print(f'    Duplicate triples: {len(dups2)}')
    print(f'    Extra rows: {total_extra2}')
    for r in dups2[:5]:
        print(f'    {r[0]:8s} {r[1]} type={r[2]:25s} ×{r[3]}')
    print()

    # Sample duplicate rows (with id + created_at)
    sub_banner('Sample duplicate rows (with id + created_at)')
    sample_dups = conn.execute("""
        SELECT id, ticker, signal_date, signal_type, path, canonical_state, status, created_at
        FROM radar_signal_tracking
        WHERE (ticker, signal_date, signal_type) IN (
            SELECT ticker, signal_date, signal_type
            FROM radar_signal_tracking
            GROUP BY ticker, signal_date, signal_type
            HAVING COUNT(*) > 1
        )
        ORDER BY ticker, signal_date, signal_type, id
        LIMIT 30
    """).fetchall()
    print(f'  {"id":>8s} {"ticker":8s} {"date":12s} {"signal_type":25s} {"path":22s} {"cs":20s} {"status":12s} {"created_at":22s}')
    print('  ' + '-' * 145)
    for r in sample_dups:
        print(f'  {r[0]:>8d} {r[1]:8s} {r[2]:12s} {r[3]:25s} {str(r[4] or "NULL"):22s} {str(r[5] or ""):20s} {str(r[6] or ""):12s} {str(r[7] or ""):22s}')

    conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 5: predictions.db deep audit
# ═══════════════════════════════════════════════════════════════════════════

def audit_predictions(db_path: Path):
    banner('SECTION 9: predictions.db DEEP AUDIT')

    if not db_path.exists():
        print(f'  [db not found]')
        return

    try:
        conn = connect_ro(db_path)
    except Exception as e:
        print(f'  [connect error: {e}]')
        return

    total = conn.execute('SELECT COUNT(*) FROM predictions').fetchone()[0]
    print(f'  Total predictions: {total}')

    if total == 0:
        conn.close()
        return

    # By market
    sub_banner('predictions by market')
    try:
        for r in conn.execute(
            'SELECT market, COUNT(*) FROM predictions GROUP BY market ORDER BY 2 DESC'
        ).fetchall():
            print(f'  {str(r[0] or "<NULL>"):15s} {r[1]:>8d}')
    except Exception as e:
        print(f'  [error: {e}]')

    # By signal
    sub_banner('predictions by signal')
    for r in conn.execute(
        'SELECT signal, COUNT(*) FROM predictions GROUP BY signal ORDER BY 2 DESC LIMIT 10'
    ).fetchall():
        print(f'  {str(r[0] or "<NULL>"):15s} {r[1]:>8d}')

    # With/without actual_return
    sub_banner('outcome coverage')
    try:
        with_ar = conn.execute('SELECT COUNT(*) FROM predictions WHERE actual_return IS NOT NULL').fetchone()[0]
        without_ar = total - with_ar
        print(f'  with actual_return:    {with_ar:>8d}')
        print(f'  without actual_return: {without_ar:>8d}')
    except Exception as e:
        print(f'  [error: {e}]')

    # Date range
    sub_banner('prediction date range')
    try:
        drange = conn.execute(
            'SELECT MIN(prediction_date), MAX(prediction_date) FROM predictions'
        ).fetchone()
        print(f'  earliest: {drange[0]}')
        print(f'  latest:   {drange[1]}')
    except Exception as e:
        print(f'  [error: {e}]')

    # Check for canonical_state column (should NOT exist if shadow mode never ran)
    sub_banner('canonical_state column check')
    cols = [r[1] for r in conn.execute('PRAGMA table_info(predictions)').fetchall()]
    has_cs = 'canonical_state' in cols or 'shadow_state' in cols
    print(f'  predictions table has canonical_state column: {has_cs}')
    if has_cs:
        print(f'  → VIOLATION: Shadow Mode should NOT modify predictions table')

    # Check for shadow_canonical_state_audit table
    audit_table = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='shadow_canonical_state_audit'"
    ).fetchone()
    sub_banner('shadow_canonical_state_audit table check')
    if audit_table:
        audit_count = conn.execute('SELECT COUNT(*) FROM shadow_canonical_state_audit').fetchone()[0]
        print(f'  shadow_canonical_state_audit EXISTS with {audit_count} rows')
        print(f'  → Shadow Mode has been activated on this server')
    else:
        print(f'  shadow_canonical_state_audit does NOT exist')
        print(f'  → Shadow Mode has NEVER been activated on this server')

    conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 6: news.db audit (multi-writer check)
# ═══════════════════════════════════════════════════════════════════════════

def audit_news(db_path: Path):
    banner('SECTION 10: news.db AUDIT')

    if not db_path.exists():
        print(f'  [db not found]')
        return

    try:
        conn = connect_ro(db_path)
    except Exception as e:
        print(f'  [connect error: {e}]')
        return

    # market_news sources (to detect multi-writer)
    sub_banner('market_news by source (multi-writer detection)')
    try:
        for r in conn.execute(
            'SELECT source, COUNT(*), MIN(date(created_at)), MAX(date(created_at)) FROM market_news GROUP BY source ORDER BY 2 DESC'
        ).fetchall():
            print(f'  {str(r[0] or "<NULL>"):25s} count={r[1]:>6d}  first={r[2]}  last={r[3]}')
    except Exception as e:
        print(f'  [error: {e}]')

    # news_articles (legacy)
    sub_banner('news_articles (legacy)')
    try:
        n = conn.execute('SELECT COUNT(*) FROM news_articles').fetchone()[0]
        print(f'  rows: {n}')
    except Exception as e:
        print(f'  [error: {e}]')

    conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7: Path config audit
# ═══════════════════════════════════════════════════════════════════════════

def audit_db_paths_config():
    banner('SECTION 11: DB PATHS CONFIGURATION (db_paths.py)')

    db_paths_file = Path.cwd() / 'vps-service' / 'utils' / 'db_paths.py'
    if not db_paths_file.exists():
        print(f'  [not found: {db_paths_file}]')
        return

    print(f'  File: {db_paths_file}')
    print()
    print('  --- resolved DB paths (with env overrides applied) ---')
    try:
        import sys
        sys.path.insert(0, str(Path.cwd() / 'vps-service'))
        from utils.db_paths import DBPaths
        paths = {
            'STOCKS_DB': DBPaths.STOCKS_DB,
            'PREDICTIONS_DB': DBPaths.PREDICTIONS_DB,
            'PRICE_HISTORY_DB': DBPaths.PRICE_HISTORY_DB,
            'DATA_ENGINE_DB': DBPaths.DATA_ENGINE_DB,
            'INTRADAY_DB': DBPaths.INTRADAY_DB,
            'NEWS_DB': DBPaths.NEWS_DB,
            'AUTH_DB': DBPaths.AUTH_DB,
            'MARKET_DB': DBPaths.MARKET_DB,
            'CONTENT_DB': DBPaths.CONTENT_DB,
        }
        for name, path in paths.items():
            exists = '✓' if Path(path).exists() else '✗'
            print(f'  {name:20s} = {path}  [{exists}]')
    except Exception as e:
        print(f'  [error importing DBPaths: {e}]')

    # Direct connect calls (bypass db_manager)
    sub_banner('Direct sqlite3.connect() calls (bypass db_manager)')
    print('  Searching for hardcoded DB paths in Python code...')
    result = safe_run([
        'grep', '-rn', '--include=*.py',
        '-E', r"sqlite3\.connect\(.*\.db",
        'vps-service/', 'scripts/', 'news-agent/'
    ], timeout=60)
    if result.strip():
        # Filter out db_manager itself + tests
        lines = [l for l in result.split('\n') if l and 'db_manager.py' not in l and 'test_' not in l]
        print(f'  Found {len(lines)} direct connect calls (excluding db_manager + tests):')
        for line in lines[:30]:
            print(f'    {line}')
        if len(lines) > 30:
            print(f'    ... ({len(lines) - 30} more)')
    else:
        print('  No direct connect calls found')


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 8: Ownership violations scan (static)
# ═══════════════════════════════════════════════════════════════════════════

def audit_write_paths():
    banner('SECTION 12: WRITE PATHS — INSERT/UPDATE/DELETE on tracked tables')

    # Find all INSERT/UPDATE/DELETE on key tables
    tracked_tables = ['predictions', 'radar_signal_tracking', 'market_news', 'stocks', 'price_history']

    for table in tracked_tables:
        sub_banner(f'Table: {table} — writers')
        result = safe_run([
            'grep', '-rn', '--include=*.py', '--include=*.ts', '--include=*.tsx',
            '-E', rf"(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+{table}\b",
            'vps-service/', 'src/', 'scripts/', 'news-agent/'
        ], timeout=60)

        if result.strip():
            lines = [l for l in result.split('\n') if l and 'node_modules' not in l and '.next' not in l]
            # Group by file
            from collections import defaultdict
            by_file = defaultdict(list)
            for line in lines:
                parts = line.split(':', 2)
                if len(parts) >= 2:
                    file = parts[0]
                    lineno = parts[1]
                    by_file[file].append(lineno)

            print(f'  Writers found in {len(by_file)} files:')
            for file, linenos in sorted(by_file.items()):
                print(f'    {file} (lines: {", ".join(linenos[:5])}{"..." if len(linenos) > 5 else ""})')
        else:
            print(f'  No writers found')


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main():
    print('#' * OUTPUT_WIDTH)
    print('#  GLMinvestment — Production Database Forensic Audit')
    print(f'#  Generated: {datetime.now().isoformat()}')
    print(f'#  Host: {safe_run(["hostname"]).strip()}')
    print(f'#  Cwd: {Path.cwd()}')
    print('#' * OUTPUT_WIDTH)

    # Find DB dir
    db_dir = find_db_dir()
    print(f'\nDetected DB directory: {db_dir}')

    # CRITICAL: warn if running on sandbox fallback path
    # (production VPS should be /root/GLMinvestment/db)
    db_dir_str = str(db_dir)
    if '/home/z/my-project' in db_dir_str or 'sandbox' in db_dir_str.lower():
        print('\n⚠️  WARNING: This appears to be a SANDBOX environment, not production VPS.')
        print('   Results below reflect SANDBOX sample data, NOT production state.')
        print('   For production audit, run this script on the VPS at /root/GLMinvestment/')
        print('   with: cd /root/GLMinvestment && python3 scripts/production_db_audit.py')
    elif '/root/GLMinvestment' in db_dir_str:
        print('\n✅ Production VPS path detected (/root/GLMinvestment/db).')
        print('   Results below reflect PRODUCTION data.')

    # Section 1-5: System
    audit_system_info()
    audit_git_state()
    audit_pm2_services()
    audit_cron_jobs()
    audit_env_vars()

    # Section 6: DB files
    audit_db_files(db_dir)

    # Section 7: Per-DB schema
    for db_name in DB_NAMES_TO_AUDIT:
        db_path = db_dir / db_name
        if db_path.exists():
            audit_db_schema(db_path)

    # Detailed schemas for the 3 most important tables
    audit_table_schema_detail(db_dir / 'stocks.db', 'radar_signal_tracking')
    audit_table_schema_detail(db_dir / 'predictions.db', 'predictions')
    audit_table_schema_detail(db_dir / 'news.db', 'market_news')

    # Section 8: radar_signal_tracking deep audit
    audit_radar_signal_tracking(db_dir / 'stocks.db')

    # Section 9: predictions deep audit
    audit_predictions(db_dir / 'predictions.db')

    # Section 10: news audit
    audit_news(db_dir / 'news.db')

    # Section 11: paths config
    audit_db_paths_config()

    # Section 12: write paths
    audit_write_paths()

    # Done
    banner('AUDIT COMPLETE')
    print('  This was a READ-ONLY audit. No data was modified.')
    print('  Share the full output with the engineering team to build the Ownership Registry.')
    print()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
intraday_session_preserver.py — Golden Session Preserver (cron job)
====================================================================

WHY
---
عند إغلاق السوق (مساءً / عطلات) الـ API في `src/app/api/stocks/[ticker]/intraday-flow/route.ts`
كان بـ يرجع 404 لأن الـ `stock_intraday` فاضي أو آخر session مش today.
المطلوب: ضمان إن آخر 3 جلسات (distinct dates) محفوظة دائماً
("golden sessions") بحيث الـ fallback في `intraday-flow.ts` يقدر
يخدمها بدل ما يرجع 404.

POLICY (Rule 21 + Rule 27)
--------------------------
- **Rule 21 (NO Hard DELETE)**: ممنوع `DELETE FROM stock_intraday`.
  الـ sessions الأقدم من آخر 3 بـ تتـ archive (تـ COPY) لـ
  `stock_intraday_archive` جدول جديد، مش بـ تتـ delete.
- **Rule 27 (NO-FAKE-DATA)**: ما بنختلقق sessions. الـ preserver بـ يحفظ
  الـ real sessions اللي موجودة في `stock_intraday` فعلاً.
- **Idempotent**: تشغيل الـ preserver مرتين لازم ينتج نفس النتيجة
  (INSERT OR IGNORE على الـ archive + UPSERT على meta).

ARCHITECTURE
------------
1. اقرأ `stock_intraday` واعثر على آخر 3 جلسات (distinct dates).
2. الـ sessions دي = "golden sessions" — بتـفضل في `stock_intraday`.
3. أي session أقدم من آخر 3 → اعمل لها ARCHIVE:
   - INSERT OR IGNORE INTO stock_intraday_archive
   - **لا DELETE من stock_intraday** (Rule 21).
4. حدّث `intraday_meta`:
   - `golden_sessions_retained`: عدد الـ golden sessions (default 3)
   - `last_preserve_run`: ISO timestamp (UTC, with 'Z')
   - `preserve_policy`: 'last_3_sessions_kept'

USAGE
-----
    # Dry-run (مفيش writes — بـ يـ print تقرير بس)
    python3 vps-service/jobs/intraday_session_preserver.py --dry-run

    # Live run (writes archive rows + updates meta)
    python3 vps-service/jobs/intraday_session_preserver.py

    # Override paths (testing)
    python3 vps-service/jobs/intraday_session_preserver.py \\
        --intraday-db /tmp/test_intraday.db

CRON SCHEDULE (مقترح في crontab)
--------------------------------
    # شغّل بعد إغلاق السوق بـ 30 دقيقة (EGX بـ يقفل 14:30 CA → 14:00 UTC)
    30 14 * * 1-5  cd /home/z/my-project && /usr/bin/python3 \\
        vps-service/jobs/intraday_session_preserver.py >> \\
        /home/z/my-project/vps-service/logs/preserver.log 2>&1

References
----------
- Task ID: P0-ALPHA-SESSION-PRESERVER
- Rule 21 (NO Hard DELETE), Rule 27 (NO-FAKE-DATA), Rule 75 (PUSH-AFTER-EVERY-TASK)
- Companion TS helper: `src/lib/intraday-flow.ts` (golden session fallback)
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# ─── Path resolution ──────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INTRADAY_DB = PROJECT_ROOT / 'db' / 'intraday.db'

# ─── Policy constants ────────────────────────────────────────────────────
GOLDEN_SESSIONS_TO_RETAIN = 3
PRESERVE_POLICY = 'last_3_sessions_kept'
ARCHIVE_TABLE = 'stock_intraday_archive'

META_KEYS = {
    'golden_sessions_retained': str(GOLDEN_SESSIONS_TO_RETAIN),
    'preserve_policy': PRESERVE_POLICY,
    # last_preserve_run is set at runtime (null until first live run).
}


# ─── DB helpers ──────────────────────────────────────────────────────────

def _connect(db_path: str, *, read_only: bool = False) -> sqlite3.Connection:
    """Open a SQLite connection with safe defaults."""
    uri = f'file:{db_path}?mode=ro' if read_only else f'file:{db_path}?mode=rwc'
    conn = sqlite3.connect(uri, uri=True, timeout=30)
    conn.execute('PRAGMA busy_timeout = 30000')
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_archive_table(conn: sqlite3.Connection) -> bool:
    """Create `stock_intraday_archive` if not exists.

    Schema mirrors `stock_intraday` (same column types) PLUS:
      - `archived_at` TEXT NOT NULL  → ISO timestamp of the archive operation
      - `archived_reason` TEXT       → free-form reason string

    Uses `UNIQUE(ticker, timestamp)` to keep the archive idempotent
    (re-running the preserver on the same data does NOT duplicate rows).
    """
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {ARCHIVE_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT,
            timestamp TEXT NOT NULL,
            price REAL NOT NULL,
            change_percent REAL DEFAULT 0,
            volume INTEGER DEFAULT 0,
            open REAL DEFAULT 0,
            high REAL DEFAULT 0,
            low REAL DEFAULT 0,
            archived_at TEXT NOT NULL,
            archived_reason TEXT,
            UNIQUE(ticker, timestamp)
        )
    """)
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{ARCHIVE_TABLE}_date "
        f"ON {ARCHIVE_TABLE}(substr(timestamp, 1, 10))"
    )
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{ARCHIVE_TABLE}_ticker "
        f"ON {ARCHIVE_TABLE}(ticker)"
    )
    conn.commit()
    return True


def _ensure_meta_table(conn: sqlite3.Connection) -> None:
    """Make sure `intraday_meta` exists (idempotent)."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS intraday_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    conn.commit()


def _list_distinct_sessions(conn: sqlite3.Connection) -> List[str]:
    """Return all distinct session dates in `stock_intraday`, newest first."""
    try:
        rows = conn.execute(
            "SELECT DISTINCT substr(timestamp, 1, 10) AS d "
            "FROM stock_intraday "
            "WHERE timestamp IS NOT NULL AND length(timestamp) >= 10 "
            "ORDER BY d DESC"
        ).fetchall()
        return [r['d'] for r in rows if r['d']]
    except sqlite3.OperationalError as e:
        # Most likely: table stock_intraday does not exist.
        print(f"[preserver] stock_intraday not readable: {e}", file=sys.stderr)
        return []


def _count_rows_for_session(conn: sqlite3.Connection, date_str: str) -> int:
    """Count rows for a given session date in stock_intraday."""
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM stock_intraday "
        "WHERE substr(timestamp, 1, 10) = ?",
        (date_str,),
    ).fetchone()
    return int(row['c']) if row else 0


def _count_archived_for_session(conn: sqlite3.Connection, date_str: str) -> int:
    """Count already-archived rows for a given session date."""
    row = conn.execute(
        f"SELECT COUNT(*) AS c FROM {ARCHIVE_TABLE} "
        f"WHERE substr(timestamp, 1, 10) = ?",
        (date_str,),
    ).fetchone()
    return int(row['c']) if row else 0


def _archive_session(
    conn: sqlite3.Connection,
    date_str: str,
    *,
    dry_run: bool,
    archived_at: str,
    reason: str,
) -> Dict[str, Any]:
    """Copy all rows of a session into stock_intraday_archive.

    Idempotent: uses `INSERT OR IGNORE` on UNIQUE(ticker, timestamp).
    Never deletes from stock_intraday (Rule 21).
    """
    source_rows = conn.execute(
        "SELECT ticker, market, timestamp, price, change_percent, "
        "       volume, open, high, low "
        "FROM stock_intraday "
        "WHERE substr(timestamp, 1, 10) = ? "
        "  AND price IS NOT NULL AND price > 0",
        (date_str,),
    ).fetchall()

    already_archived = _count_archived_for_session(conn, date_str)
    inserted = 0
    skipped_dup = 0

    if dry_run:
        # In dry-run we still report what WOULD happen, but make no writes.
        return {
            'session_date': date_str,
            'source_rows': len(source_rows),
            'already_archived': already_archived,
            'would_insert': max(0, len(source_rows) - already_archived),
            'inserted': 0,
            'skipped_dup': 0,
            'dry_run': True,
            'reason': reason,
        }

    for r in source_rows:
        cur = conn.execute(
            f"INSERT OR IGNORE INTO {ARCHIVE_TABLE} "
            f"(ticker, market, timestamp, price, change_percent, volume, "
            f" open, high, low, archived_at, archived_reason) "
            f"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                r['ticker'], r['market'], r['timestamp'], r['price'],
                r['change_percent'] or 0, r['volume'] or 0,
                r['open'] or 0, r['high'] or 0, r['low'] or 0,
                archived_at, reason,
            ),
        )
        if cur.rowcount > 0:
            inserted += 1
        else:
            skipped_dup += 1

    conn.commit()
    return {
        'session_date': date_str,
        'source_rows': len(source_rows),
        'already_archived': already_archived,
        'inserted': inserted,
        'skipped_dup': skipped_dup,
        'dry_run': False,
        'reason': reason,
    }


def _update_meta(conn: sqlite3.Connection, *, dry_run: bool, last_run_iso: Optional[str]) -> None:
    """Upsert policy rows into intraday_meta.

    On dry-run: only ensures the 2 static policy rows are set
    (`golden_sessions_retained`, `preserve_policy`). `last_preserve_run`
    is left untouched (or set to NULL on first init).
    On live run: sets `last_preserve_run` to the supplied ISO timestamp.
    """
    _ensure_meta_table(conn)
    for key, value in META_KEYS.items():
        conn.execute(
            "INSERT INTO intraday_meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
    if not dry_run and last_run_iso is not None:
        conn.execute(
            "INSERT INTO intraday_meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ('last_preserve_run', last_run_iso),
        )
    else:
        # Ensure the row exists (NULL until first live run).
        conn.execute(
            "INSERT OR IGNORE INTO intraday_meta (key, value) VALUES (?, NULL)",
            ('last_preserve_run',),
        )
    conn.commit()


def _read_meta(conn: sqlite3.Connection) -> Dict[str, Optional[str]]:
    """Snapshot of intraday_meta after the run."""
    _ensure_meta_table(conn)
    rows = conn.execute(
        "SELECT key, value FROM intraday_meta ORDER BY key"
    ).fetchall()
    return {r['key']: r['value'] for r in rows}


# ─── Main entry point ────────────────────────────────────────────────────

def run_preserver(
    intraday_db: str = str(DEFAULT_INTRADAY_DB),
    *,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Run the golden session preserver.

    Returns a structured report dict.
    """
    started_at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    report: Dict[str, Any] = {
        'task_id': 'P0-ALPHA-SESSION-PRESERVER',
        'started_at': started_at,
        'dry_run': dry_run,
        'intraday_db': intraday_db,
        'policy': PRESERVE_POLICY,
        'golden_sessions_target': GOLDEN_SESSIONS_TO_RETAIN,
        'sessions': [],
        'archived': [],
        'meta_before': None,
        'meta_after': None,
        'errors': [],
    }

    if not os.path.exists(intraday_db):
        report['errors'].append(f'intraday.db not found: {intraday_db}')
        return report

    conn = _connect(intraday_db, read_only=dry_run)
    try:
        if dry_run:
            # ─── DRY-RUN: truly read-only ────────────────────────────────
            # We do NOT create the archive table, do NOT write to it, and
            # do NOT update intraday_meta. We only READ what exists and
            # report what WOULD happen on a live run.
            report['note'] = (
                'DRY-RUN: no writes. Archive table not created, meta not updated.'
            )
            try:
                # Try to read sessions + meta if the tables already exist.
                sessions = _list_distinct_sessions(conn)
            except sqlite3.OperationalError:
                sessions = []
            report['sessions'] = [
                {'date': d, 'row_count': _count_rows_for_session(conn, d)}
                for d in sessions
            ]
            # Read meta snapshot (if table exists).
            try:
                report['meta_before'] = _read_meta(conn)
            except sqlite3.OperationalError:
                report['meta_before'] = {}
            report['meta_after'] = dict(report['meta_before'])
            # Project what would happen.
            golden = sessions[:GOLDEN_SESSIONS_TO_RETAIN]
            older = sessions[GOLDEN_SESSIONS_TO_RETAIN:]
            report['golden_sessions'] = golden
            report['older_sessions_to_archive'] = older
            for d in older:
                source_count = _count_rows_for_session(conn, d)
                # We cannot read archive table if it doesn't exist yet — fall back to 0.
                try:
                    already = _count_archived_for_session(conn, d)
                except sqlite3.OperationalError:
                    already = 0
                report['archived'].append({
                    'session_date': d,
                    'source_rows': source_count,
                    'already_archived': already,
                    'would_insert': max(0, source_count - already),
                    'inserted': 0,
                    'skipped_dup': 0,
                    'dry_run': True,
                    'reason': f'older than last {GOLDEN_SESSIONS_TO_RETAIN} golden sessions',
                })
            # Projected meta_after (no actual write).
            projected = dict(report['meta_before'])
            projected['golden_sessions_retained'] = str(GOLDEN_SESSIONS_TO_RETAIN)
            projected['preserve_policy'] = PRESERVE_POLICY
            projected.setdefault('last_preserve_run', None)
            report['meta_after'] = projected
            report['projected_meta_after'] = projected
            report['finished_at'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            return report

        # ─── LIVE RUN ────────────────────────────────────────────────────
        # 1. Ensure schema
        _ensure_archive_table(conn)
        _ensure_meta_table(conn)
        report['meta_before'] = _read_meta(conn)

        # 2. Distinct sessions (newest first)
        sessions = _list_distinct_sessions(conn)
        report['sessions'] = [
            {'date': d, 'row_count': _count_rows_for_session(conn, d)}
            for d in sessions
        ]

        if not sessions:
            # Table is empty — Rule 27: don't fabricate. Just update meta.
            report['note'] = (
                'stock_intraday empty — no sessions to preserve. '
                'Meta policy rows updated; last_preserve_run set to current run timestamp.'
            )
            _update_meta(conn, dry_run=False, last_run_iso=started_at)
            report['meta_after'] = _read_meta(conn)
            report['finished_at'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            return report

        # 3. Golden = last N sessions (newest)
        golden = sessions[:GOLDEN_SESSIONS_TO_RETAIN]
        # 4. Older sessions → archive (instead of delete)
        older = sessions[GOLDEN_SESSIONS_TO_RETAIN:]

        report['golden_sessions'] = golden
        report['older_sessions_to_archive'] = older

        for d in older:
            archived_at = started_at
            reason = f'older than last {GOLDEN_SESSIONS_TO_RETAIN} golden sessions'
            res = _archive_session(
                conn, d, dry_run=False,
                archived_at=archived_at, reason=reason,
            )
            report['archived'].append(res)

        # 5. Update meta
        _update_meta(conn, dry_run=False, last_run_iso=started_at)
        report['meta_after'] = _read_meta(conn)
        report['finished_at'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        return report
    except Exception as e:
        report['errors'].append(f'{type(e).__name__}: {e}')
        return report
    finally:
        conn.close()


# ─── CLI ─────────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description='Golden Session Preserver — keep last 3 sessions, '
                    'archive older ones (Rule 21: no hard delete).',
    )
    p.add_argument(
        '--dry-run', action='store_true',
        help='Print report only; do not write to archive or meta.last_preserve_run.',
    )
    p.add_argument(
        '--intraday-db', default=str(DEFAULT_INTRADAY_DB),
        help=f'Path to intraday.db (default: {DEFAULT_INTRADAY_DB})',
    )
    p.add_argument(
        '--json', action='store_true',
        help='Emit the final report as JSON (default: pretty-printed).',
    )
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    report = run_preserver(
        intraday_db=args.intraday_db,
        dry_run=args.dry_run,
    )

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    else:
        print(_pretty_report(report))

    # Exit code: 0 if no errors, 1 otherwise.
    return 1 if report.get('errors') else 0


def _pretty_report(r: Dict[str, Any]) -> str:
    lines: List[str] = []
    lines.append('=' * 72)
    lines.append('GOLDEN SESSION PRESERVER — REPORT')
    lines.append('=' * 72)
    lines.append(f"Task ID           : {r.get('task_id')}")
    lines.append(f"Started at        : {r.get('started_at')}")
    lines.append(f"Finished at       : {r.get('finished_at', '—')}")
    lines.append(f"Dry run           : {r.get('dry_run')}")
    lines.append(f"Intraday DB       : {r.get('intraday_db')}")
    lines.append(f"Policy            : {r.get('policy')}")
    lines.append(f"Golden target     : {r.get('golden_sessions_target')}")
    lines.append('')
    lines.append('─ Sessions in stock_intraday ─')
    sessions = r.get('sessions') or []
    if not sessions:
        lines.append('  (no sessions — table empty)')
    for s in sessions:
        lines.append(f"  {s['date']}  rows={s['row_count']}")
    lines.append('')
    lines.append(f"─ Golden sessions (kept in stock_intraday) ─")
    for g in r.get('golden_sessions', []):
        lines.append(f"  {g}  ✓ preserved")
    lines.append('')
    lines.append(f"─ Older sessions → archived to {ARCHIVE_TABLE} ─")
    archived = r.get('archived') or []
    if not archived:
        lines.append('  (none — no sessions older than the golden 3)')
    for a in archived:
        if a.get('dry_run'):
            lines.append(
                f"  [DRY-RUN] {a['session_date']}  "
                f"source={a['source_rows']} already_archived={a['already_archived']} "
                f"would_insert={a['would_insert']}"
            )
        else:
            lines.append(
                f"  {a['session_date']}  source={a['source_rows']} "
                f"inserted={a['inserted']} skipped_dup={a['skipped_dup']} "
                f"(already_archived={a['already_archived']})"
            )
    lines.append('')
    lines.append('─ intraday_meta (BEFORE) ─')
    mb = r.get('meta_before') or {}
    for k in sorted(mb.keys()):
        lines.append(f"  {k:30} = {mb[k]!r}")
    lines.append('')
    lines.append('─ intraday_meta (AFTER) ─')
    ma = r.get('meta_after') or {}
    for k in sorted(ma.keys()):
        lines.append(f"  {k:30} = {ma[k]!r}")
    if r.get('errors'):
        lines.append('')
        lines.append('─ Errors ─')
        for e in r['errors']:
            lines.append(f"  ! {e}")
    lines.append('=' * 72)
    return '\n'.join(lines)


if __name__ == '__main__':
    sys.exit(main())

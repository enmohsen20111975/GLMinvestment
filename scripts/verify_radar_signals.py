#!/usr/bin/env python3
"""
verify_radar_signals.py — تحديث نتائج إشارات الرادار بعد 7/14/30 يوم
=====================================================================
Task IMPROVEMENT-22-2026-10-07 (Rule 71)

الهدف:
  يفحص كل الإشارات الـ 'pending' في radar_signal_tracking
  ويحدّث outcome_7d / outcome_14d / outcome_30d بناءً على الأسعار الفعلية.

المنطق:
  لكل إشارة pending:
    1. يجيب تاريخ الإشارة + سعر الدخول + الـ ticker
    2. يفحص سعر السهم بعد 7/14/30 يوم من price_history.db
    3. يحسب outcome_% = (price_after - entry_price) / entry_price * 100
    4. يحسب max_price_after + min_price_after
    5. لو 30 يوم عدّوا → يحدّث status لـ 'verified_win' أو 'verified_loss'

CLI:
  python3 scripts/verify_radar_signals.py
  python3 scripts/verify_radar_signals.py --dry-run
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')

# BRAVO-FIX-F1 (2026-10-25): unified 4-source cascade mirroring
# src/app/api/maker-radar/signal-tracker/verify/route.ts PRICE_SOURCES.
# Before this fix, the Python script read ONLY from price_history.db while the
# TS route read from data_engine.db.egksco_price_history (+ 3 fallbacks).
# Same signal → two different outcomes depending on which verifier ran.
# Now both verifiers use the same 4-source cascade in the same order.
UNIFIED_PRICE_SOURCES = [
    # 1. data_engine.db.egksco_price_history (price_date column)
    dict(db=DATA_ENGINE_DB, table='egksco_price_history', tkr='symbol', date='price_date',
         close='close_price', high='high_price', low='low_price'),
    # 2. stocks.db.egksco_price_history (date column — different schema)
    dict(db=STOCKS_DB, table='egksco_price_history', tkr='symbol', date='date',
         close='close_price', high='high_price', low='low_price'),
    # 3. stocks.db.stock_daily_prices
    dict(db=STOCKS_DB, table='stock_daily_prices', tkr='ticker', date='price_date',
         close='close', high='high', low='low'),
    # 4. data_engine.db.historical_data (non-EGX fallback)
    dict(db=DATA_ENGINE_DB, table='historical_data', tkr='symbol', date='date',
         close='close', high='high', low='low'),
]


def _fetch_n_sessions_from_sources(ticker, signal_date, n_sessions, market_filter='EGX'):
    """BRAVO-FIX-F1-v2 (2026-10-25): fetch the N-th TRADING SESSION after signal_date.

    Previous F1 fix unified the price SOURCE but kept calendar-day counting:
    `target_date = signal_date + timedelta(days=N)`. This is WRONG because:
    - Weekends (Fri+Sat on EGX) are skipped, so calendar+7 ≠ 7th trading session.
    - Holidays further increase the gap.
    - Result: the "7d outcome" was computed on the 5th or 6th trading session,
      not the 7th.

    This function fetches the first N trading sessions strictly AFTER
    signal_date (matching the TS route's `prices[N-1]` = N-th trading session),
    and returns:
      - nth_close: close of the N-th trading session
      - max_high:  max(high) across all N sessions
      - min_low:   min(low)  across all N sessions
      - source:    which DB::table produced the data
      - sessions:  list of (date, close) for transparency/debugging
    Returns None if fewer than N sessions are available.
    """
    import os as _os
    for src in UNIFIED_PRICE_SOURCES:
        if not _os.path.exists(src['db']):
            continue
        try:
            conn = sqlite3.connect(f"file:{src['db']}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (src['table'],))
            if not cur.fetchone():
                conn.close(); continue
            # C2 FIX: check market column
            cur.execute(f"PRAGMA table_info({src['table']})")
            tcols = [r[1] for r in cur.fetchall()]
            market_clause = "AND market = 'EGX'" if ('market' in tcols and market_filter) else ""
            # Fetch first N trading sessions strictly AFTER signal_date.
            rows = cur.execute(
                f"SELECT {src['date']} AS d, {src['close']} AS c, "
                f"       {src['high']} AS h, {src['low']} AS l "
                f"FROM {src['table']} "
                f"WHERE {src['tkr']}=? AND {src['date']}>? "
                f"AND {src['close']} IS NOT NULL AND {src['close']}>0 "
                f"{market_clause} "
                f"ORDER BY {src['date']} ASC LIMIT ?",
                (ticker, signal_date, n_sessions)
            ).fetchall()
            if len(rows) < n_sessions:
                conn.close(); continue  # not enough sessions in this source
            nth = rows[n_sessions - 1]  # 0-indexed: rows[6] = 7th session
            nth_close = float(nth['c'])
            highs = [float(r['h']) for r in rows if r['h'] is not None]
            lows  = [float(r['l']) for r in rows if r['l'] is not None]
            max_high = max(highs) if highs else nth_close
            min_low  = min(lows)  if lows  else nth_close
            sessions = [(r['d'], float(r['c'])) for r in rows]
            conn.close()
            label = f"{_os.path.basename(src['db'])}::{src['table']}"
            return nth_close, max_high, min_low, label, sessions
        except Exception:
            try: conn.close()
            except: pass
            continue
    return None


def _fetch_price_from_sources(ticker, signal_date, target_date):
    """Legacy fallback — kept for backward compat with callers that pass a
    target_date. NOT used by the new trading-session path.
    """
    import os as _os
    for src in UNIFIED_PRICE_SOURCES:
        if not _os.path.exists(src['db']):
            continue
        try:
            conn = sqlite3.connect(f"file:{src['db']}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (src['table'],))
            if not cur.fetchone():
                conn.close(); continue
            row = cur.execute(
                f"SELECT {src['close']} AS c FROM {src['table']} "
                f"WHERE {src['tkr']}=? AND {src['date']}>=? "
                f"AND {src['close']} IS NOT NULL AND {src['close']}>0 "
                f"ORDER BY {src['date']} ASC LIMIT 1",
                (ticker, target_date.strftime('%Y-%m-%d'))
            ).fetchone()
            if not row:
                conn.close(); continue
            close_after = float(row['c'])
            w = cur.execute(
                f"SELECT MAX({src['high']}) AS mx, MIN({src['low']}) AS mn "
                f"FROM {src['table']} "
                f"WHERE {src['tkr']}=? AND {src['date']}>? AND {src['date']}<=? "
                f"AND {src['close']} IS NOT NULL AND {src['close']}>0",
                (ticker, signal_date, target_date.strftime('%Y-%m-%d'))
            ).fetchone()
            mx = float(w['mx']) if w and w['mx'] else close_after
            mn = float(w['mn']) if w and w['mn'] else close_after
            conn.close()
            label = f"{_os.path.basename(src['db'])}::{src['table']}"
            return close_after, mx, mn, label
        except Exception:
            try: conn.close()
            except: pass
            continue
    return None


def log(msg: str):
    print(f"[verify-radar] {msg}", flush=True)


def get_price_after(ticker: str, signal_date: str, days_after: int) -> tuple:
    """الحصول على إغلاق الجلسة رقم N + max/min في الفترة.

    BRAVO-FIX-F1-v2 (2026-10-25): trading-session counting, not calendar days.
    - Fetches the N-th actual trading session after signal_date (skipping
      weekends and holidays automatically via ORDER BY date ASC LIMIT N).
    - Matches TS route `prices[N-1].close` exactly.
    - Falls back to legacy calendar-day path only if unified sources have
      fewer than N sessions AND price_history.db has more (rare).
    - Returns (nth_close, max_high, min_low).
    """
    try:
        result = _fetch_n_sessions_from_sources(ticker, signal_date, days_after)
        if result is not None:
            nth_close, max_high, min_low, _label, _sessions = result
            return nth_close, max_high, min_low

        # Legacy fallback: price_history.db with calendar-day target.
        # Only fires when unified sources lack N sessions (e.g. very recent
        # signal, or ticker only in price_history.db).
        signal_dt = datetime.strptime(signal_date[:10], '%Y-%m-%d')
        target_date = signal_dt + timedelta(days=days_after)
        from core.db_manager import db_manager
        conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        # Try trading-session path on price_history.db too (N-th session)
        rows = conn.execute("""
            SELECT close_price, high_price, low_price, date
            FROM price_history
            WHERE ticker = ? AND date > ? AND close_price IS NOT NULL AND close_price > 0
            AND market = 'EGX'
            ORDER BY date ASC LIMIT ?
        """, (ticker, signal_date, days_after)).fetchall()
        if len(rows) >= days_after:
            nth = rows[days_after - 1]
            close_after = float(nth['close_price'])
            highs = [float(r['high_price']) for r in rows if r['high_price']]
            lows  = [float(r['low_price'])  for r in rows if r['low_price']]
            max_price = max(highs) if highs else close_after
            min_price = min(lows)  if lows  else close_after
            conn.close()
            return close_after, max_price, min_price
        conn.close()
        return None, None, None
    except Exception as e:
        return None, None, None


def verify_signals(dry_run: bool = False):
    """تحديث كل الإشارات الـ pending."""
    log("═══ Radar Signal Verification ═══")
    log(f"Time: {datetime.now().isoformat()}")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    conn.row_factory = sqlite3.Row

    # كل الإشارات pending
    pending = conn.execute("""
        SELECT id, ticker, signal_date, entry_price, path, signal_type, status
        FROM radar_signal_tracking
        WHERE status = 'pending'
        ORDER BY signal_date DESC
    """).fetchall()

    log(f"Pending signals: {len(pending)}")

    if not pending:
        log("✅ No pending signals to verify")
        conn.close()
        return

    updated_7d = 0
    updated_14d = 0
    updated_30d = 0
    verified_win = 0
    verified_loss = 0

    for sig in pending:
        sig_id = sig['id']
        ticker = sig['ticker']
        signal_date = sig['signal_date']
        entry_price = sig['entry_price']

        if not entry_price or entry_price <= 0:
            continue

        sig_dt = datetime.strptime(signal_date[:10].replace('-', ''), '%Y%m%d') if '-' not in signal_date[:10] else datetime.strptime(signal_date[:10], '%Y-%m-%d')
        now = datetime.now()
        days_elapsed = (now - sig_dt).days

        updates = {}

        # 7 يوم
        if days_elapsed >= 7:
            close_7d, max_7d, min_7d = get_price_after(ticker, signal_date, 7)
            if close_7d is not None:
                outcome_7d = round((close_7d - entry_price) / entry_price * 100, 2)
                updates['outcome_7d'] = outcome_7d
                updates['max_price_after'] = max_7d
                updates['min_price_after'] = min_7d
                updated_7d += 1

        # 14 يوم
        if days_elapsed >= 14:
            close_14d, max_14d, min_14d = get_price_after(ticker, signal_date, 14)
            if close_14d is not None:
                outcome_14d = round((close_14d - entry_price) / entry_price * 100, 2)
                updates['outcome_14d'] = outcome_14d
                # حدّث max/min لو فيه بيانات أحدث
                if max_14d and (not updates.get('max_price_after') or max_14d > updates['max_price_after']):
                    updates['max_price_after'] = max_14d
                if min_14d and (not updates.get('min_price_after') or min_14d < updates['min_price_after']):
                    updates['min_price_after'] = min_14d
                updated_14d += 1

        # 30 يوم
        if days_elapsed >= 30:
            close_30d, max_30d, min_30d = get_price_after(ticker, signal_date, 30)
            if close_30d is not None:
                outcome_30d = round((close_30d - entry_price) / entry_price * 100, 2)
                updates['outcome_30d'] = outcome_30d
                if max_30d and (not updates.get('max_price_after') or max_30d > updates['max_price_after']):
                    updates['max_price_after'] = max_30d
                if min_30d and (not updates.get('min_price_after') or min_30d < updates['min_price_after']):
                    updates['min_price_after'] = min_30d
                updated_30d += 1

                # تحديد Win/Loss
                if outcome_30d >= 5.0:
                    updates['status'] = 'verified_win'
                    verified_win += 1
                elif outcome_30d <= -7.0:
                    updates['status'] = 'verified_loss'
                    verified_loss += 1
                else:
                    updates['status'] = 'verified_neutral'

                updates['verified_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        if updates and not dry_run:
            set_clauses = ', '.join(f'{k} = ?' for k in updates)
            values = list(updates.values()) + [sig_id]
            conn.execute(f"UPDATE radar_signal_tracking SET {set_clauses} WHERE id = ?", values)

    if not dry_run:
        conn.commit()

    conn.close()

    log(f"\n=== Verification Summary ===")
    log(f"  7d outcomes updated: {updated_7d}")
    log(f"  14d outcomes updated: {updated_14d}")
    log(f"  30d outcomes updated: {updated_30d}")
    log(f"  Verified wins: {verified_win}")
    log(f"  Verified losses: {verified_loss}")

    if dry_run:
        log(f"\n⚠️ DRY RUN — no changes written to DB")
    else:
        log(f"\n✅ All updates committed to stocks.db")


if __name__ == '__main__':
    dry = '--dry-run' in sys.argv
    verify_signals(dry_run=dry)

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


def log(msg: str):
    print(f"[verify-radar] {msg}", flush=True)


def get_price_after(ticker: str, signal_date: str, days_after: int) -> tuple:
    """الحصول على سعر السهم بعد N يوم + max/min في الفترة."""
    try:
        signal_dt = datetime.strptime(signal_date[:10], '%Y-%m-%d')
        target_date = signal_dt + timedelta(days=days_after)

        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
        conn.row_factory = sqlite3.Row

        # السعر بعد N يوم (أقرب يوم تداول)
        row = conn.execute("""
            SELECT close_price, high_price, low_price
            FROM price_history
            WHERE ticker = ? AND date >= ? AND close_price IS NOT NULL AND close_price > 0
            ORDER BY date ASC LIMIT 1
        """, (ticker, target_date.strftime('%Y-%m-%d'))).fetchone()

        if not row:
            conn.close()
            return None, None, None

        close_after = float(row['close_price'])

        # max/min في الفترة (من signal_date لـ target_date)
        rows = conn.execute("""
            SELECT MAX(high_price) as max_price, MIN(low_price) as min_price
            FROM price_history
            WHERE ticker = ? AND date > ? AND date <= ? AND close_price IS NOT NULL AND close_price > 0
        """, (ticker, signal_date, target_date.strftime('%Y-%m-%d'))).fetchone()

        max_price = float(rows['max_price']) if rows and rows['max_price'] else close_after
        min_price = float(rows['min_price']) if rows and rows['min_price'] else close_after

        conn.close()
        return close_after, max_price, min_price
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

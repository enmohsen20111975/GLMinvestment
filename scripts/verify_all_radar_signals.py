#!/usr/bin/env python3
"""
verify_all_radar_signals.py — GLM5.2-RADAR-S2-VERIFY-ENGINE
============================================================

Batch-verifies ALL pending radar signals in `radar_signal_tracking` against
real price data in `stock_daily_prices` (db/stocks.db).

CRITICAL CONTEXT:
- `db/price_history.db` is MALFORMED ("database disk image is malformed")
  and CANNOT be used. The authoritative price source is the
  `stock_daily_prices` table in `db/stocks.db` (100,619 candles;
  schema: ticker, price_date, open, high, low, close, volume).
- Rule 27 (NO-FAKE-DATA): never fabricate prices. If a signal has zero
  rows in `stock_daily_prices` after its signal_date, it is marked
  `stale_data` (NOT verified).

EVALUATION LOGIC (mirrors src/app/api/maker-radar/signal-tracker/verify/route.ts):
- WIN_7D_PCT    = +2.5    # 7-day  early-win threshold
- WIN_14D_PCT   = +4.0    # 14-day mid-win   threshold
- STOP_LOSS_PCT = -5.0    # stop-loss breach (any day in window)
- outcome_7d  = FIRST close in trading days 1..7  with pct >= +2.5%
- outcome_14d = FIRST close in trading days 1..14 with pct >= +4.0%
- outcome_30d = ((close_30d - entry) / entry) * 100  (only if 30d elapsed)
- max_price_after / min_price_after = true excursion (high/low with close fallback)

STATUS DETERMINATION (priority order):
  1. prices empty after signal_date           → stale_data (no verification)
  2. min_price_after <= entry * 0.95          → verified_loss (stop-loss breach)
  3. outcome_7d != null (>= +2.5% in 7 days)  → verified_win
  4. outcome_14d != null (>= +4.0% in 14 days)→ verified_win
  5. outcome_30d != null:
       outcome_30d >= +2.5%                   → verified_win
       outcome_30d <= -5.0%                   → verified_loss
       else                                   → verified_neutral
  6. else                                     → pending (partial data; < 30d elapsed)

IDEMPOTENCY:
- Skips any signal with status LIKE 'verified_%' (already verified).
- Stale_data signals are re-evaluated only with --include-stale flag.
- Running the script twice (with --execute) MUST produce zero changes on
  the second run (idempotent by design).

USAGE:
    # Default: dry-run — print report only, do NOT modify DB.
    python3 scripts/verify_all_radar_signals.py

    # Actually update the DB.
    python3 scripts/verify_all_radar_signals.py --execute

    # Limit number of signals processed (for smoke testing).
    python3 scripts/verify_all_radar_signals.py --limit 50 --execute

    # Re-check stale_data signals too (useful after backfilling prices).
    python3 scripts/verify_all_radar_signals.py --execute --include-stale

Exit codes:
    0  — success (dry-run or execute)
    1  — fatal error (DB unreachable / malformed, etc.)
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, List, Optional, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# Paths (Rule 17 — ROOT-CAUSE-FIRST): use repo-relative paths.
# ─────────────────────────────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = Path(os.environ.get('PROJECT_ROOT') or str(_SCRIPT_DIR.parent))
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'

# ─────────────────────────────────────────────────────────────────────────────
# Thresholds — MUST mirror src/app/api/maker-radar/signal-tracker/verify/route.ts
# ─────────────────────────────────────────────────────────────────────────────
WIN_7D_PCT = 2.5      # +2.5% — 7-day early-win
WIN_14D_PCT = 4.0      # +4.0% — 14-day mid-win
STOP_LOSS_PCT = -5.0   # -5.0% — stop-loss breach (any day)
NEUTRAL_LO_PCT = -5.0  # outcome_30d <= this → verified_loss
NEUTRAL_HI_PCT = 2.5   # outcome_30d >= this → verified_win

# Fetch window: up to 30 trading days after signal_date.
FETCH_LIMIT = 30


# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────
def open_db(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise FileNotFoundError(f'DB not found: {path}')
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def fetch_prices_after(conn: sqlite3.Connection, ticker: str, signal_date: str,
                       limit: int = FETCH_LIMIT) -> List[Tuple[str, float, float, float]]:
    """
    Fetch up to `limit` trading-day prices STRICTLY AFTER signal_date.
    Schema: stock_daily_prices(ticker, price_date, open, high, low, close, volume)
    high/low may be NULL → fall back to close (safe-by-design).

    Returns list of (price_date, close, high, low) tuples ordered ASC by date.
    """
    rows = conn.execute(
        """
        SELECT price_date AS d, close AS c, high AS h, low AS l
        FROM stock_daily_prices
        WHERE ticker = ?
          AND price_date > ?
          AND close IS NOT NULL
          AND close > 0
        ORDER BY price_date ASC
        LIMIT ?
        """,
        (ticker, signal_date, limit),
    ).fetchall()
    out: List[Tuple[str, float, float, float]] = []
    for r in rows:
        close = float(r['c']) if r['c'] is not None else 0.0
        if close <= 0:
            continue
        high = float(r['h']) if r['h'] is not None and r['h'] > 0 else close
        low = float(r['l']) if r['l'] is not None and r['l'] > 0 else close
        out.append((str(r['d']), close, high, low))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Outcome evaluation — mirrors verify/route.ts logic EXACTLY
# ─────────────────────────────────────────────────────────────────────────────
def evaluate_signal(entry_price: float, prices: List[Tuple[str, float, float, float]]
                    ) -> Tuple[Optional[float], Optional[float], Optional[float],
                               Optional[float], Optional[float], str]:
    """
    Returns (outcome_7d, outcome_14d, outcome_30d,
             max_price_after, min_price_after, new_status).

    `prices` MUST be ordered ASC by date. prices[0] = trading day 1 after
    signal_date, prices[6] = day 7, prices[13] = day 14, prices[29] = day 30.
    """
    if not prices:
        return (None, None, None, None, None, 'stale_data')

    # outcome_7d: FIRST close in trading days 1..7 with pct >= +2.5%
    outcome_7d = None
    for d, close, _, _ in prices[:7]:
        if close > 0:
            pct = ((close - entry_price) / entry_price) * 100
            if pct >= WIN_7D_PCT:
                outcome_7d = pct
                break

    # outcome_14d: FIRST close in trading days 1..14 with pct >= +4.0%
    outcome_14d = None
    for d, close, _, _ in prices[:14]:
        if close > 0:
            pct = ((close - entry_price) / entry_price) * 100
            if pct >= WIN_14D_PCT:
                outcome_14d = pct
                break

    # outcome_30d: final 30th-day close pct (only if 30 trading days elapsed)
    outcome_30d = None
    if len(prices) >= 30 and prices[29][1] > 0:
        outcome_30d = ((prices[29][1] - entry_price) / entry_price) * 100

    # Max / min excursion (true range after signal)
    highs = [p[2] for p in prices if p[2] > 0]
    lows = [p[3] for p in prices if p[3] > 0]
    max_price = max(highs) if highs else None
    min_price = min(lows) if lows else None

    # Status priority (must match route.ts):
    #   1. stop-loss breach (any day) → verified_loss
    #   2. outcome_7d != null         → verified_win
    #   3. outcome_14d != null        → verified_win
    #   4. outcome_30d != null        → win/loss/neutral by threshold
    #   5. else                       → pending (partial data)
    stop_loss_triggered = (
        min_price is not None
        and min_price > 0
        and min_price <= entry_price * (1 + STOP_LOSS_PCT / 100)
    )
    if stop_loss_triggered:
        new_status = 'verified_loss'
    elif outcome_7d is not None:
        new_status = 'verified_win'
    elif outcome_14d is not None:
        new_status = 'verified_win'
    elif outcome_30d is not None:
        if outcome_30d >= NEUTRAL_HI_PCT:
            new_status = 'verified_win'
        elif outcome_30d <= NEUTRAL_LO_PCT:
            new_status = 'verified_loss'
        else:
            new_status = 'verified_neutral'
    else:
        new_status = 'pending'

    return (outcome_7d, outcome_14d, outcome_30d, max_price, min_price, new_status)


# ─────────────────────────────────────────────────────────────────────────────
# Status snapshot helper (for before/after reporting)
# ─────────────────────────────────────────────────────────────────────────────
def status_snapshot(conn: sqlite3.Connection) -> dict:
    rows = conn.execute(
        """
        SELECT COALESCE(status, 'NULL') AS status, COUNT(*) AS n
        FROM radar_signal_tracking
        GROUP BY COALESCE(status, 'NULL')
        ORDER BY status
        """
    ).fetchall()
    return {r['status']: r['n'] for r in rows}


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(
        description='Batch-verify pending radar signals against stock_daily_prices.'
    )
    ap.add_argument('--execute', action='store_true',
                    help='Actually update the DB (default: dry-run only).')
    ap.add_argument('--limit', type=int, default=0,
                    help='Limit number of signals processed (0 = no limit).')
    ap.add_argument('--include-stale', action='store_true',
                    help='Also re-evaluate stale_data signals '
                         '(default: skip them).')
    args = ap.parse_args()

    mode = 'EXECUTE' if args.execute else 'DRY-RUN'
    print(f'=== verify_all_radar_signals.py [{mode}] ===')
    print(f'PROJECT_ROOT: {PROJECT_ROOT}')
    print(f'STOCKS_DB:    {STOCKS_DB}')
    print()

    if not STOCKS_DB.exists():
        print(f'FATAL: stocks.db not found at {STOCKS_DB}', file=sys.stderr)
        return 1

    # Verify stock_daily_prices exists and has data
    conn = open_db(STOCKS_DB)
    try:
        # Sanity: ensure tracker table exists
        tbl = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='radar_signal_tracking'"
        ).fetchone()
        if not tbl:
            print('FATAL: radar_signal_tracking table not found in stocks.db',
                  file=sys.stderr)
            return 1
        # Sanity: ensure stock_daily_prices exists and is non-empty
        cnt = conn.execute('SELECT COUNT(*) FROM stock_daily_prices').fetchone()[0]
        if cnt == 0:
            print('FATAL: stock_daily_prices is empty (no price data)',
                  file=sys.stderr)
            return 1
        print(f'[precheck] stock_daily_prices rows: {cnt:,}')

        # ── BEFORE snapshot ──
        before = status_snapshot(conn)
        print('[BEFORE] status distribution:')
        total = 0
        for k, v in sorted(before.items()):
            print(f'   {k:20s} : {v}')
            total += v
        print(f'   {"TOTAL":20s} : {total}')
        print()
    finally:
        conn.close()

    # ── Select signals to process ──
    conn = open_db(STOCKS_DB)
    try:
        statuses = ["'pending'", "'stale_data'"] if args.include_stale else ["'pending'"]
        # Always also include NULL status (defensive)
        where = (
            f"(status = {statuses[0]}"
            + ('' if len(statuses) == 1
                else f" OR status = {statuses[1]}")
            + " OR status IS NULL)"
        )
        sql = (
            f"SELECT id, ticker, signal_date, entry_price, status "
            f"FROM radar_signal_tracking "
            f"WHERE {where} "
            f"ORDER BY signal_date ASC"
        )
        if args.limit > 0:
            sql += f' LIMIT {int(args.limit)}'
        rows = conn.execute(sql).fetchall()
    finally:
        conn.close()

    if not rows:
        print('No signals to process (all already verified_* or none pending).')
        return 0

    print(f'[scan] signals to evaluate: {len(rows)}')
    if args.limit > 0:
        print(f'[scan] limit applied: {args.limit}')
    if args.include_stale:
        print('[scan] --include-stale: stale_data signals WILL be re-evaluated')
    print()

    # ── Evaluate each signal (read-only at first) ──
    results: List[dict] = []
    counters = {
        'verified_win': 0,
        'verified_loss': 0,
        'verified_neutral': 0,
        'stale_data': 0,
        'pending': 0,           # partial data — no status change
        'skipped': 0,           # already verified_* — idempotency
        'error': 0,
    }
    sample_changes: List[dict] = []  # first 10 changes for the report

    for r in rows:
        sid = r['id']
        ticker = r['ticker']
        signal_date = r['signal_date']
        entry_price = float(r['entry_price']) if r['entry_price'] is not None else 0.0
        current_status = r['status']

        # Idempotency: skip already-verified signals
        if current_status and current_status.startswith('verified_'):
            counters['skipped'] += 1
            continue

        if not entry_price or entry_price <= 0:
            counters['error'] += 1
            results.append({
                'id': sid, 'ticker': ticker, 'signal_date': signal_date,
                'error': 'invalid entry_price',
            })
            continue

        # Fetch prices (single connection per iteration to keep things simple
        # and avoid locking the DB during the whole batch).
        try:
            # Reuse a single connection (read-only fetch).
            # We re-open per iteration to mirror route.ts behavior (which opens
            # a fresh connection per request) — this also ensures we don't
            # hold a long-lived read lock that blocks the UI.
            c = open_db(STOCKS_DB)
            try:
                prices = fetch_prices_after(c, ticker, signal_date, FETCH_LIMIT)
            finally:
                c.close()
        except Exception as e:
            counters['error'] += 1
            results.append({
                'id': sid, 'ticker': ticker, 'signal_date': signal_date,
                'error': f'price_fetch_error: {e}',
            })
            continue

        outcome_7d, outcome_14d, outcome_30d, max_p, min_p, new_status = \
            evaluate_signal(entry_price, prices)

        # Idempotency: if the new status matches the current status AND the
        # outcome metrics are already set, we could skip the UPDATE — but
        # for simplicity and consistency, we always re-write (the values are
        # deterministic from the price data; idempotent by construction).
        counters[new_status] = counters.get(new_status, 0) + 1

        rec = {
            'id': sid,
            'ticker': ticker,
            'signal_date': signal_date,
            'entry_price': entry_price,
            'current_status': current_status,
            'new_status': new_status,
            'outcome_7d': outcome_7d,
            'outcome_14d': outcome_14d,
            'outcome_30d': outcome_30d,
            'max_price_after': max_p,
            'min_price_after': min_p,
            'days_available': len(prices),
        }
        results.append(rec)

        if len(sample_changes) < 10 and new_status != current_status:
            sample_changes.append(rec)

    # ── Dry-run report ──
    print('=== DRY-RUN REPORT ===')
    print(f'signals scanned     : {len(rows)}')
    print(f'skipped (verified_*) : {counters["skipped"]}  (idempotency)')
    print(f'errors              : {counters["error"]}')
    print()
    print('PROPOSED status changes:')
    print(f'  verified_win      : {counters["verified_win"]}')
    print(f'  verified_loss     : {counters["verified_loss"]}')
    print(f'  verified_neutral  : {counters["verified_neutral"]}')
    print(f'  stale_data        : {counters["stale_data"]}  (no prices available)')
    print(f'  pending (partial) : {counters["pending"]}  (insufficient days; kept pending)')
    print()

    if sample_changes:
        print('--- sample changes (first 10) ---')
        for r in sample_changes:
            o7 = f'{r["outcome_7d"]:+.2f}%' if r['outcome_7d'] is not None else '—'
            o14 = f'{r["outcome_14d"]:+.2f}%' if r['outcome_14d'] is not None else '—'
            o30 = f'{r["outcome_30d"]:+.2f}%' if r['outcome_30d'] is not None else '—'
            print(f'  id={r["id"]:5d}  {r["ticker"]:8s}  '
                  f'{r["signal_date"]}  '
                  f'entry={r["entry_price"]:8.2f}  '
                  f'{r["current_status"]} → {r["new_status"]}  '
                  f'7d={o7}  14d={o14}  30d={o30}  '
                  f'days={r["days_available"]}')
        print()

    if not args.execute:
        print('=== DRY-RUN COMPLETE — no DB changes made. ===')
        print('Re-run with --execute to apply changes.')
        return 0

    # ── EXECUTE — apply changes ──
    print('=== EXECUTE — applying changes ===')
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = open_db(STOCKS_DB)
    updated = 0
    try:
        cur = conn.cursor()
        for r in results:
            # Skip records that were errors or already-verified.
            if 'error' in r:
                continue
            new_status = r.get('new_status')
            if not new_status:
                continue
            # Idempotency: if new status equals current status AND metrics are
            # already set, the UPDATE is a no-op (still safe to run).
            cur.execute(
                """
                UPDATE radar_signal_tracking
                SET outcome_7d = ?, outcome_14d = ?, outcome_30d = ?,
                    max_price_after = ?, min_price_after = ?,
                    status = ?, verified_at = ?
                WHERE id = ?
                """,
                (
                    r['outcome_7d'],
                    r['outcome_14d'],
                    r['outcome_30d'],
                    r['max_price_after'],
                    r['min_price_after'],
                    new_status,
                    now_iso if new_status.startswith('verified_') else None,
                    r['id'],
                ),
            )
            updated += cur.rowcount
        conn.commit()
    finally:
        conn.close()

    print(f'rows updated: {updated}')
    print()

    # ── AFTER snapshot ──
    conn = open_db(STOCKS_DB)
    try:
        after = status_snapshot(conn)
    finally:
        conn.close()

    print('[AFTER] status distribution:')
    total = 0
    for k, v in sorted(after.items()):
        print(f'   {k:20s} : {v}')
        total += v
    print(f'   {"TOTAL":20s} : {total}')
    print()

    # ── Diff summary ──
    print('=== DIFF SUMMARY (before → after) ===')
    all_keys = sorted(set(list(before.keys()) + list(after.keys())))
    for k in all_keys:
        b = before.get(k, 0)
        a = after.get(k, 0)
        delta = a - b
        marker = ' *' if delta != 0 else ''
        print(f'  {k:20s} : {b:5d} → {a:5d}  (Δ {delta:+d}){marker}')
    print()
    print(f'=== EXECUTE COMPLETE — {updated} rows updated. ===')
    return 0


if __name__ == '__main__':
    sys.exit(main())

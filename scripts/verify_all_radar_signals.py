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

EVALUATION LOGIC (BRAVO-1-RADAR-VERIFY — Chronological Day-by-Day):
================================================================================
PREVIOUS BUG (pre-BRAVO-1): the old logic checked stop-loss across ALL 30 days
FIRST, then checked the win. This meant a signal that hit +5% target on day 3
but later retraced to -5% on day 20 was wrongly marked verified_loss — a
fatal trading flaw that under-reported wins (~35% win rate).

NEW LOGIC — "من يضرب أولًا يفوز" (first to hit wins):
- Fetch prices STRICTLY AFTER signal_date, ORDERED ASC by price_date.
- Iterate day-by-day (chronological order). On each day:
    (a) Target hit? → high >= entry_price * 1.05  (+5% target)
    (b) Stop hit?   → low  <= entry_price * 0.95  (-5% stop)
  - If only target hit on day N → verified_win (stop scanning).
  - If only stop hit on day N   → verified_loss (stop scanning).
  - If BOTH hit on same day N (ambiguous without intraday data):
        close >= entry_price → verified_win (target likely hit first)
        close <  entry_price → verified_loss (stop likely hit first)

TRAILING STOP (after win is recorded):
- Once verified_win is recorded, status STAYS verified_win even if the price
  later drops below entry_price (breakeven trailing stop = profit-taking, NOT
  a loss). The `trailing_stop_hit` flag is set to 1 if any subsequent day has
  low <= entry_price.

NEW COLUMNS (added via ALTER TABLE if missing):
- win_date TEXT          — date the +5% target was first hit
- peak_return REAL       — (max_high - entry) / entry * 100 (entire window)
- trailing_stop_hit INTEGER DEFAULT 0 — 1 if low <= entry after win_date

COMPATIBILITY (kept for API: src/app/api/maker-radar/signal-tracker/route.ts):
- outcome_7d  = FIRST close in trading days 1..7  with pct >= +2.5%
- outcome_14d = FIRST close in trading days 1..14 with pct >= +4.0%
- outcome_30d = ((close_30d - entry) / entry) * 100  (only if 30d elapsed)
- max_price_after / min_price_after = true excursion (high/low with close fallback)
These outcome_* fields are computed for API continuity; the STATUS is now
determined by the chronological target/stop logic above (NOT by outcome_*).

STATUS DETERMINATION (BRAVO-1 priority order):
  1. prices empty after signal_date              → stale_data (no verification)
  2. CHRONOLOGICAL: target hit before stop       → verified_win (PRIMARY FIX)
  3. CHRONOLOGICAL: stop hit before target       → verified_loss (PRIMARY FIX)
  4. neither hit — legacy close-based fallback:
       outcome_7d  >= +2.5% (close, days 1..7)   → verified_win
       outcome_14d >= +4.0% (close, days 1..14)  → verified_win
  5. neither hit, but 30d elapsed:
       outcome_30d >= +2.5%                      → verified_win
       outcome_30d <= -5.0%                      → verified_loss
       else                                      → verified_neutral
  6. else (partial data, < 30d elapsed)          → pending

DATA-QUALITY FIX (BRAVO-1):
  stock_daily_prices has ~8,070 rows where high < close and ~7,514 rows where
  low > close (impossible OHLC). fetch_prices_after now falls back to close
  for BOTH high and low when this is detected (Rule 27-safe — uses the
  authoritative close). This prevents fake lows from triggering the -5% stop.

IDEMPOTENCY:
- Skips any signal with status LIKE 'verified_%' (already verified).
- Stale_data signals are re-evaluated only with --include-stale flag.
- Running the script twice (with --execute) MUST produce zero changes on
  the second run (idempotent by construction — all metrics are deterministic
  from the price data; verified_at is only re-written when the status
  transitions to a verified_* state).

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
WIN_7D_PCT = 2.5      # +2.5% — 7-day early-win (API-compat outcome_7d)
WIN_14D_PCT = 4.0      # +4.0% — 14-day mid-win (API-compat outcome_14d)
STOP_LOSS_PCT = -5.0   # -5.0% — stop-loss breach
NEUTRAL_LO_PCT = -5.0  # outcome_30d <= this → verified_loss (30d fallback)
NEUTRAL_HI_PCT = 2.5   # outcome_30d >= this → verified_win  (30d fallback)

# BRAVO-1-RADAR-VERIFY — Chronological target/stop thresholds.
TARGET_PCT = 5.0       # +5.0% — primary target (high >= entry * 1.05)
STOP_PCT = -5.0        # -5.0% — stop-loss      (low  <= entry * 0.95)

# Fetch window: up to 30 trading days after signal_date.
FETCH_LIMIT = 30

# New columns added by BRAVO-1-RADAR-VERIFY (idempotent ALTER TABLE).
NEW_COLUMNS = [
    ('win_date', 'TEXT'),
    ('peak_return', 'REAL'),
    ('trailing_stop_hit', 'INTEGER DEFAULT 0'),
]


# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────
def open_db(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise FileNotFoundError(f'DB not found: {path}')
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def ensure_new_columns(conn: sqlite3.Connection) -> None:
    """
    BRAVO-1-RADAR-VERIFY: add new columns for chronological evaluation.
    Idempotent — uses ALTER TABLE only if the column doesn't already exist.
    Columns: win_date, peak_return, trailing_stop_hit.
    """
    existing = {row['name'] for row in conn.execute(
        "PRAGMA table_info(radar_signal_tracking)"
    ).fetchall()}
    for col_name, col_type in NEW_COLUMNS:
        if col_name not in existing:
            conn.execute(
                f"ALTER TABLE radar_signal_tracking "
                f"ADD COLUMN {col_name} {col_type}"
            )
            print(f'[schema] added column: {col_name} ({col_type})')
    conn.commit()


def fetch_prices_after(conn: sqlite3.Connection, ticker: str, signal_date: str,
                       limit: int = FETCH_LIMIT) -> List[Tuple[str, float, float, float]]:
    """
    Fetch up to `limit` trading-day prices STRICTLY AFTER signal_date.
    Schema: stock_daily_prices(ticker, price_date, open, high, low, close, volume)
    high/low may be NULL → fall back to close (safe-by-design).

    BRAVO-1 DATA-QUALITY FIX: stock_daily_prices has ~8,070 rows where high < close
    and ~7,514 rows where low > close (impossible — high must be >= close >= low).
    These bad rows would corrupt the chronological target/stop race (e.g., a fake
    low of 13.19 with close 17.1 would wrongly trigger the -5% stop). When high
    or low violates close, we fall back to close for BOTH high and low (conservative
    — treats the day as a flat close). This is Rule 27-safe (no fabrication;
    we use the authoritative close price).

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
        # BRAVO-1 DATA-QUALITY FIX: if high < close or low > close, the high/low
        # are corrupt (impossible OHLC). Fall back to close for both.
        if high < close or low > close or low > high:
            high = close
            low = close
        out.append((str(r['d']), close, high, low))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Outcome evaluation — BRAVO-1-RADAR-VERIFY (Chronological Day-by-Day)
# =============================================================================
# PREVIOUS BUG: stop-loss was checked across ALL 30 days FIRST, then win was
#   checked. A signal that hit +5% on day 3 then retraced to -5% on day 20
#   was wrongly marked verified_loss → ~35% win rate (under-reported wins).
# FIX: iterate day-by-day; whoever hits FIRST wins. Target = +5% (high),
#   Stop = -5% (low). If both hit on the same day, use close to disambiguate.
# =============================================================================
def evaluate_signal(entry_price: float, prices: List[Tuple[str, float, float, float]]
                    ) -> Tuple[Optional[float], Optional[float], Optional[float],
                               Optional[float], Optional[float], str,
                               Optional[str], Optional[float], int]:
    """
    Chronological day-by-day evaluation (BRAVO-1-RADAR-VERIFY fix).

    Returns (outcome_7d, outcome_14d, outcome_30d,
             max_price_after, min_price_after, new_status,
             win_date, peak_return, trailing_stop_hit).

    `prices` MUST be ordered ASC by date. prices[0] = trading day 1 after
    signal_date, prices[6] = day 7, prices[13] = day 14, prices[29] = day 30.

    RULE: "من يضرب أولًا يفوز" (first to hit wins).
    - Target: high >= entry_price * (1 + TARGET_PCT/100)  → +5%
    - Stop:   low  <= entry_price * (1 + STOP_PCT/100)    → -5%
    - Iterate day-by-day; the first day where either is hit determines the
      outcome. If both hit on the same day (ambiguous without intraday data),
      use close to decide:
          close >= entry_price → verified_win (target likely hit first)
          close <  entry_price → verified_loss (stop likely hit first)

    TRAILING STOP (after win is recorded):
    - Once verified_win is recorded, the status STAYS verified_win even if the
      price later drops below entry_price (breakeven trailing stop = profit-
      taking, NOT a loss). `trailing_stop_hit` is set to 1 if any subsequent
      day has low <= entry_price.
    - `peak_return` = (max_high_across_window - entry) / entry * 100.
    """
    if not prices:
        return (None, None, None, None, None, 'stale_data', None, None, 0)

    # ── outcome_7d / outcome_14d / outcome_30d (kept for API compatibility) ──
    # These use CLOSE-based thresholds (+2.5% / +4.0%) — they do NOT drive
    # the status anymore; the status is driven by the chronological logic.
    outcome_7d = None
    for d, close, _, _ in prices[:7]:
        if close > 0:
            pct = ((close - entry_price) / entry_price) * 100
            if pct >= WIN_7D_PCT:
                outcome_7d = pct
                break

    outcome_14d = None
    for d, close, _, _ in prices[:14]:
        if close > 0:
            pct = ((close - entry_price) / entry_price) * 100
            if pct >= WIN_14D_PCT:
                outcome_14d = pct
                break

    outcome_30d = None
    if len(prices) >= 30 and prices[29][1] > 0:
        outcome_30d = ((prices[29][1] - entry_price) / entry_price) * 100

    # Max / min excursion (true range after signal) — kept for API compat.
    highs = [p[2] for p in prices if p[2] > 0]
    lows = [p[3] for p in prices if p[3] > 0]
    max_price = max(highs) if highs else None
    min_price = min(lows) if lows else None

    # ── CHRONOLOGICAL evaluation (BRAVO-1 fix) ──────────────────────────────
    target_price = entry_price * (1 + TARGET_PCT / 100)   # entry * 1.05
    stop_price = entry_price * (1 + STOP_PCT / 100)       # entry * 0.95

    win_date: Optional[str] = None
    loss_date: Optional[str] = None
    win_idx: Optional[int] = None

    for i, (d, close, high, low) in enumerate(prices):
        target_hit = high >= target_price
        stop_hit = low <= stop_price

        if target_hit and stop_hit:
            # Ambiguous — both touched intraday. Use close to decide which
            # was likely hit first. If close >= entry, the bar ended in the
            # trader's favor → assume target hit first (win). Otherwise, the
            # bar ended against the trader → assume stop hit first (loss).
            if close >= entry_price:
                win_date = d
                win_idx = i
            else:
                loss_date = d
            break
        elif target_hit:
            win_date = d
            win_idx = i
            break
        elif stop_hit:
            loss_date = d
            break

    # peak_return across the ENTIRE window (max high seen).
    peak_return: Optional[float] = None
    if max_price is not None and max_price > 0:
        peak_return = (max_price - entry_price) / entry_price * 100

    # Trailing stop logic — only relevant if a win was recorded.
    # After the win day, if any subsequent day has low <= entry_price, the
    # breakeven trailing stop was hit. The status STAYS verified_win.
    trailing_stop_hit = 0
    if win_idx is not None:
        for d, close, high, low in prices[win_idx + 1:]:
            if low <= entry_price:
                trailing_stop_hit = 1
                break

    # ── Determine status ────────────────────────────────────────────────────
    # Priority order (BRAVO-1-RADAR-VERIFY):
    #   1. Chronological race: target (+5% high) vs stop (-5% low) — first to
    #      hit wins. This is the PRIMARY determination (the bug fix).
    #   2. If neither hit, fall back to the legacy close-based win thresholds
    #      (kept for continuity with the API + older verified signals):
    #        outcome_7d  >= +2.5% (close, days 1..7)  → verified_win
    #        outcome_14d >= +4.0% (close, days 1..14) → verified_win
    #   3. If 30 days elapsed, use outcome_30d (close) for win/loss/neutral.
    #   4. Otherwise → pending (partial data).
    if win_date is not None:
        new_status = 'verified_win'
    elif loss_date is not None:
        new_status = 'verified_loss'
    elif outcome_7d is not None:
        # Legacy 7-day close-based win (kept for backward compatibility).
        new_status = 'verified_win'
        # win_date stays None — the +5% high target was NOT hit; this is a
        # softer (close-based) win. peak_return still reflects the max high.
    elif outcome_14d is not None:
        # Legacy 14-day close-based win (kept for backward compatibility).
        new_status = 'verified_win'
    elif len(prices) >= 30:
        # 30 days elapsed, neither target nor stop hit → use outcome_30d.
        if outcome_30d is not None:
            if outcome_30d >= NEUTRAL_HI_PCT:
                new_status = 'verified_win'
            elif outcome_30d <= NEUTRAL_LO_PCT:
                new_status = 'verified_loss'
            else:
                new_status = 'verified_neutral'
        else:
            new_status = 'pending'
    else:
        # Partial data (< 30 days) and neither target nor stop hit → pending.
        new_status = 'pending'

    return (outcome_7d, outcome_14d, outcome_30d, max_price, min_price, new_status,
            win_date, peak_return, trailing_stop_hit)


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

        # BRAVO-1-RADAR-VERIFY: ensure new columns exist (idempotent ALTER TABLE).
        ensure_new_columns(conn)

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

        outcome_7d, outcome_14d, outcome_30d, max_p, min_p, new_status, \
            win_date, peak_return, trailing_stop_hit = \
            evaluate_signal(entry_price, prices)

        # Idempotency: the values are deterministic from the price data.
        # We always re-evaluate to capture any new price days, but the UPDATE
        # is skipped when new_status == current_status (true idempotency on
        # the second run — zero rows updated).
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
            'win_date': win_date,
            'peak_return': peak_return,
            'trailing_stop_hit': trailing_stop_hit,
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
            pr = f'{r["peak_return"]:+.2f}%' if r['peak_return'] is not None else '—'
            wd = r['win_date'] or '—'
            ts = 'TS' if r['trailing_stop_hit'] else '  '
            print(f'  id={r["id"]:5d}  {r["ticker"]:8s}  '
                  f'{r["signal_date"]}  '
                  f'entry={r["entry_price"]:8.2f}  '
                  f'{r["current_status"]:14s} → {r["new_status"]:14s}  '
                  f'peak={pr:7s}  win_date={wd}  {ts}  '
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
    status_changed = 0
    try:
        cur = conn.cursor()
        for r in results:
            # Skip records that were errors or already-verified.
            if 'error' in r:
                continue
            new_status = r.get('new_status')
            if not new_status:
                continue
            # Idempotency (BRAVO-1): skip UPDATE entirely when the new status
            # equals the current status. This guarantees the second --execute
            # run produces ZERO row updates (true idempotency). Pending →
            # pending re-evaluations are skipped; verified_* signals are not
            # re-selected at all (WHERE clause excludes them).
            if new_status == r.get('current_status'):
                continue
            cur.execute(
                """
                UPDATE radar_signal_tracking
                SET outcome_7d = ?, outcome_14d = ?, outcome_30d = ?,
                    max_price_after = ?, min_price_after = ?,
                    status = ?, verified_at = ?,
                    win_date = ?, peak_return = ?, trailing_stop_hit = ?
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
                    r.get('win_date'),
                    r.get('peak_return'),
                    r.get('trailing_stop_hit', 0),
                    r['id'],
                ),
            )
            updated += cur.rowcount
            status_changed += 1
        conn.commit()
    finally:
        conn.close()

    print(f'rows updated (status changed): {updated}')
    print(f'status transitions           : {status_changed}')
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

    # ── Win-rate calculation (BRAVO-1-RADAR-VERIFY) ──
    wins = after.get('verified_win', 0)
    losses = after.get('verified_loss', 0)
    neutrals = after.get('verified_neutral', 0)
    verified_total = wins + losses + neutrals
    win_rate = (wins / verified_total * 100) if verified_total > 0 else 0.0
    print('=== WIN-RATE (BRAVO-1-RADAR-VERIFY) ===')
    print(f'  verified_win     : {wins}')
    print(f'  verified_loss    : {losses}')
    print(f'  verified_neutral : {neutrals}')
    print(f'  verified total   : {verified_total}')
    print(f'  win_rate_pct     : {win_rate:.2f}%')
    # Trailing-stop stats (only meaningful for verified_win signals).
    conn = open_db(STOCKS_DB)
    try:
        ts_stats = conn.execute(
            """
            SELECT
              SUM(CASE WHEN trailing_stop_hit = 1 THEN 1 ELSE 0 END) AS ts_hit,
              SUM(CASE WHEN trailing_stop_hit = 0 THEN 1 ELSE 0 END) AS ts_not_hit,
              COUNT(*) AS total_wins
            FROM radar_signal_tracking
            WHERE status = 'verified_win'
            """
        ).fetchone()
        avg_peak = conn.execute(
            "SELECT AVG(peak_return) FROM radar_signal_tracking WHERE status='verified_win' AND peak_return IS NOT NULL"
        ).fetchone()[0]
    finally:
        conn.close()
    print(f'  trailing_stop_hit (wins where low<=entry post-win): {ts_stats["ts_hit"]}/{ts_stats["total_wins"]}')
    print(f'  avg peak_return (wins): {avg_peak:.2f}%' if avg_peak is not None else '  avg peak_return: N/A')
    print()
    print(f'=== EXECUTE COMPLETE — {updated} rows updated. ===')
    return 0


if __name__ == '__main__':
    sys.exit(main())

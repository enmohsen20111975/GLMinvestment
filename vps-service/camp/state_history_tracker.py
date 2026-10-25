#!/usr/bin/env python3
"""
State History Tracker — records daily state assessments + transitions.

Uses canonical_stock_state.assess_state() to classify each stock daily,
then stores the result in radar_signal_tracking (enhanced with transition columns).

Phase 3 of the Liquidity Radar development plan.
"""
from __future__ import annotations

import sys, os, json, sqlite3, time
from pathlib import Path
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'camp'))
sys.path.insert(0, str(VPS / 'analyzers'))

DB_DIR = PROJECT_ROOT / 'db'
RESULTS_DIR = PROJECT_ROOT / 'scripts' / 'camp' / 'results'


def ensure_state_columns(conn: sqlite3.Connection):
    """Add transition tracking columns to radar_signal_tracking if missing."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(radar_signal_tracking)").fetchall()]
    additions = []
    if 'canonical_state' not in cols:
        additions.append("ADD COLUMN canonical_state TEXT DEFAULT ''")
    if 'prev_state' not in cols:
        additions.append("ADD COLUMN prev_state TEXT DEFAULT ''")
    if 'transition_type' not in cols:
        additions.append("ADD COLUMN transition_type TEXT DEFAULT ''")
    if 'days_in_state' not in cols:
        additions.append("ADD COLUMN days_in_state INTEGER DEFAULT 0")
    if 'confidence' not in cols:
        additions.append("ADD COLUMN confidence REAL DEFAULT 0.0")
    if 'direction_up' not in cols:
        additions.append("ADD COLUMN direction_up REAL DEFAULT 0.0")
    if 'direction_down' not in cols:
        additions.append("ADD COLUMN direction_down REAL DEFAULT 0.0")
    if 'evidence_json' not in cols:
        additions.append("ADD COLUMN evidence_json TEXT DEFAULT ''")
    if 'invalidation_json' not in cols:
        additions.append("ADD COLUMN invalidation_json TEXT DEFAULT ''")
    if 'data_freshness' not in cols:
        additions.append("ADD COLUMN data_freshness TEXT DEFAULT ''")
    # P0-DELETE-OWNERSHIP-FIX: ensure source column exists for ownership scoping.
    # maker_radar also adds this column, but state_history_tracker may run first
    # on a fresh DB, so we ensure it here too (idempotent — ALTER TABLE ADD COLUMN
    # is a no-op if the column already exists).
    if 'source' not in cols:
        additions.append("ADD COLUMN source TEXT DEFAULT 'maker_radar'")

    for add in additions:
        try:
            conn.execute(f"ALTER TABLE radar_signal_tracking {add}")
            print(f"  ✅ Added column: {add.split('ADD COLUMN ')[1].split()[0]}")
        except Exception as e:
            if "duplicate column" not in str(e):
                print(f"  ⚠️ {add}: {e}")
    conn.commit()


def get_prev_state(conn: sqlite3.Connection, ticker: str, current_date: str) -> Tuple[str, str, int]:
    """Get previous state for a ticker from the last assessment before current_date."""
    row = conn.execute("""
        SELECT canonical_state, signal_date, days_in_state FROM radar_signal_tracking
        WHERE ticker=? AND signal_date < ? AND canonical_state != ''
        ORDER BY signal_date DESC LIMIT 1
    """, (ticker, current_date)).fetchone()
    if row:
        return row[0], row[1], row[2] or 0
    return '', '', 0


def assess_and_record(conn_ph: sqlite3.Connection, conn_st: sqlite3.Connection,
                       ticker: str, assessment_date: str) -> Dict[str, Any]:
    """Assess one ticker's state and record it."""
    from canonical_stock_state import assess_state

    # Load price history (at least 250 days for MA200)
    rows = conn_ph.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker=? AND date<=? AND close_price>0 AND high_price>0
        ORDER BY date DESC LIMIT 300
    """, (ticker, assessment_date)).fetchall()

    if len(rows) < 60:
        return {'ticker': ticker, 'state': 'DATA_INCOMPLETE', 'skipped': True}

    # Rows are DESC (newest first) — reverse to oldest first
    rows = list(reversed(rows))
    d = [r[0] for r in rows]
    o = [float(r[1] or 0) for r in rows]
    h = [float(r[2] or 0) for r in rows]
    l = [float(r[3] or 0) for r in rows]
    c = [float(r[4]) for r in rows]
    v = [int(r[5] or 0) for r in rows]

    # Get previous state
    prev_state, prev_date, prev_days = get_prev_state(conn_st, ticker, assessment_date)

    # Assess
    # FIX (Phase 2 — owner directive): buy_pct=None (was hardcoded 55).
    # canonical_stock_state.assess_state now skips E6 evidence when bp is
    # None and falls back to STATE_UNCONFIRMED if remaining evidence is
    # insufficient. We do NOT fabricate a flow signal.
    # FIX (Phase 2): pass latest_price_date = d[-1] (last close date) so
    # the freshness check compares the actual last close to the assessment
    # date, not datetime.now().
    result = assess_state(
        ticker=ticker, date=assessment_date,
        closes=c, highs=h, lows=l, volumes=v,
        buy_pct=None,  # no real money_flow data wired in yet — explicit
        prev_state=prev_state,
        latest_price_date=d[-1] if d else assessment_date,
    )

    # Calculate days_in_state
    if result.transition_type == 'CONTINUE' and prev_state == result.state:
        days_in_state = prev_days + 1
    else:
        days_in_state = 1

    # Record in DB
    evidence_json = json.dumps({
        'supporting': [{'name': e.name, 'value': e.value, 'weight': e.weight, 'description': e.description}
                       for e in result.evidence_supporting],
        'opposing': [{'name': e.name, 'value': e.value, 'weight': e.weight, 'description': e.description}
                     for e in result.evidence_opposing],
    }, default=str)

    invalidation_json = json.dumps(result.invalidation_conditions, default=str)

    # Upsert into radar_signal_tracking
    # FIX (Phase 2): the original SQL had 9 blank lines inside VALUES(...).
    # SQLite ignores them but it's a code-quality hazard + signals un-reviewed
    # SQL. Cleaned up to a single, well-formed statement.
    # P0-DELETE-OWNERSHIP-FIX: set source='state_history_tracker' so maker_radar's
    # scoped DELETE (WHERE source='maker_radar') does not wipe these rows.
    conn_st.execute("""
        INSERT OR REPLACE INTO radar_signal_tracking
            (ticker, signal_date, signal_type, entry_price, status,
             canonical_state, prev_state, transition_type, days_in_state,
             confidence, direction_up, direction_down,
             evidence_json, invalidation_json, data_freshness, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'state_history_tracker')
    """, (
        ticker, assessment_date, 'canonical_state', result.last_price, 'assessed',
        result.state, prev_state, result.transition_type, days_in_state,
        result.confidence, result.direction_probability['up'], result.direction_probability['down'],
        evidence_json, invalidation_json, result.data_freshness,
    ))
    conn_st.commit()

    return result.to_dict()


def run_daily_assessment(tickers: List[str] = None, assessment_date: str = None, limit: int = 50):
    """Run state assessment for multiple tickers."""
    from canonical_stock_state import assess_state, STATE_AR

    if assessment_date is None:
        assessment_date = datetime.now().strftime('%Y-%m-%d')

    conn_ph = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30)
    conn_st = sqlite3.connect(str(DB_DIR / 'stocks.db'), timeout=30)

    # Ensure columns exist
    ensure_state_columns(conn_st)

    # Get tickers if not provided
    if tickers is None:
        tickers = [r[0] for r in conn_ph.execute("""
            SELECT DISTINCT ticker FROM price_history
            WHERE date=? AND ticker NOT LIKE '%.%' AND close_price>0
            ORDER BY ticker LIMIT ?
        """, (assessment_date, limit)).fetchall()]

    print(f"\n{'='*90}")
    print(f"  State History Tracker — {assessment_date}")
    print(f"  Tickers: {len(tickers)}")
    print(f"{'='*90}\n")

    print(f"{'Ticker':<8} {'State':<22} {'Conf':>5} {'Up%':>5} {'Down%':>6} {'Days':>5} {'Transition':<12}")
    print(f"{'-'*75}")

    results = []
    state_counts = {}
    for t in tickers:
        try:
            result = assess_and_record(conn_ph, conn_st, t, assessment_date)
            if result.get('skipped'):
                print(f"{t:<8} {'SKIP':<22} — insufficient data")
                continue
            ar = STATE_AR.get(result['state'], result['state'])
            state_counts[result['state']] = state_counts.get(result['state'], 0) + 1
            print(f"{t:<8} {result['state']:<22} {result['confidence']:>4.2f} {result['direction_probability']['up']:>4.0%} {result['direction_probability']['down']:>5.0%} {result['days_in_state']:>5} {result['transition_type']:<12}")
            results.append(result)
        except Exception as e:
            print(f"{t:<8} ERROR: {type(e).__name__}: {str(e)[:50]}")

    print(f"\n{'='*60}")
    print(f"  Summary:")
    for s, n in sorted(state_counts.items(), key=lambda x: -x[1]):
        print(f"    {s:<22}: {n} tickers")
    print(f"  Total assessed: {len(results)}")
    print(f"{'='*60}")

    conn_ph.close()
    conn_st.close()

    # Save results
    with open(RESULTS_DIR / 'state_history.json', 'w') as f:
        json.dump({'date': assessment_date, 'results': results, 'summary': state_counts},
                  f, indent=2, default=str)

    return results


def get_state_timeline(conn: sqlite3.Connection, ticker: str, days: int = 30) -> List[Dict]:
    """Get state history timeline for a ticker."""
    rows = conn.execute("""
        SELECT signal_date, canonical_state, prev_state, transition_type,
               days_in_state, confidence, direction_up, direction_down,
               data_freshness, evidence_json
        FROM radar_signal_tracking
        WHERE ticker=? AND canonical_state != ''
        ORDER BY signal_date DESC LIMIT ?
    """, (ticker, days)).fetchall()

    timeline = []
    for r in rows:
        evidence = json.loads(r[9]) if r[9] else {}
        timeline.append({
            'date': r[0], 'state': r[1], 'prev_state': r[2],
            'transition': r[3], 'days_in_state': r[4],
            'confidence': r[5], 'direction_up': r[6], 'direction_down': r[7],
            'data_freshness': r[8],
            'evidence_supporting': len(evidence.get('supporting', [])),
            'evidence_opposing': len(evidence.get('opposing', [])),
        })
    return timeline


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='State History Tracker')
    parser.add_argument('--date', default=None, help='Assessment date (YYYY-MM-DD)')
    parser.add_argument('--tickers', nargs='*', help='Specific tickers')
    parser.add_argument('--limit', type=int, default=50, help='Max tickers')
    parser.add_argument('--timeline', help='Show timeline for ticker')
    args = parser.parse_args()

    if args.timeline:
        conn = sqlite3.connect(str(DB_DIR / 'stocks.db'), timeout=30)
        tl = get_state_timeline(conn, args.timeline, 30)
        print(f"\nState timeline for {args.timeline}:")
        for t in tl:
            print(f"  {t['date']}: {t['state']:<22} conf={t['confidence']:.2f} days={t['days_in_state']} trans={t['transition']:<12} up={t['direction_up']:.0%} down={t['direction_down']:.0%}")
        conn.close()
    else:
        run_daily_assessment(
            tickers=args.tickers,
            assessment_date=args.date,
            limit=args.limit,
        )

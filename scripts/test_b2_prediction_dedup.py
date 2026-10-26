#!/usr/bin/env python3
"""
B2 — Prediction Dedup Test Suite
================================
Task ID: 1-b (Bravo). Verifies that the B2 dedup fix works correctly.

Test scenarios (from task spec):
  1. record_prediction() twice for same ticker+day+persona+market+track
     → assert ONLY 1 row, update_count == 1, entry_price UNCHANGED.
  2. Different persona for same ticker+day → assert 2 distinct rows (NOT merged).
  3. Different ticker same day → 2 rows.
  4. Different day same ticker+persona → 2 rows.
  5. promote_incubator_candidates() simulation (same SQL pattern) called twice
     for same identity → 1 row, entry_price preserved, update_count incremented.

The test runs against a TEMP DB (NOT production). Production DB is untouched.
"""

import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

# Ensure vps-service is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
os.chdir(str(PROJECT_ROOT))


def _setup_temp_predictions_db(temp_dir: Path) -> Path:
    """Create a temp predictions.db with a predictions table compatible with B2 fix.
    Copies the production schema (table + triggers) so the B2 dedup UPDATE
    behaves identically. Returns path to the temp DB."""
    src_db = PROJECT_ROOT / 'db' / 'predictions.db'
    temp_db = temp_dir / 'predictions.db'
    # Copy the production DB then TRUNCATE the predictions table.
    shutil.copy(src_db, temp_db)
    conn = sqlite3.connect(str(temp_db))
    # Wipe all rows from predictions + archive (if any) — keeps schema + triggers + indexes.
    conn.execute("DELETE FROM predictions")
    try:
        conn.execute("DROP TABLE IF EXISTS predictions_duplicates_archive")
    except Exception:
        pass
    # Ensure B2 columns exist (mirrors migration).
    cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)")]
    if "update_count" not in cols:
        conn.execute("ALTER TABLE predictions ADD COLUMN update_count INTEGER DEFAULT 0")
    if "is_duplicate" not in cols:
        conn.execute("ALTER TABLE predictions ADD COLUMN is_duplicate INTEGER DEFAULT 0")
    # The record_prediction() primary INSERT references columns that may not exist
    # in every snapshot of the predictions table (lifecycle_status, tp1_price, etc.).
    # Add them defensively so the test can exercise the full INSERT path.
    for col, ddl in [
        ("lifecycle_status", "TEXT DEFAULT 'testing'"),
        ("tp1_price", "REAL"),
        ("tp2_price", "REAL"),
        ("trailing_stop_pct", "REAL DEFAULT 2.5"),
        ("max_hold_days", "INTEGER DEFAULT 5"),
        ("exit_protocol", "TEXT DEFAULT 'TP1_6PCT_TIME_STOP_5D'"),
        ("user_advice_ar", "TEXT DEFAULT ''"),
    ]:
        if col not in cols:
            try:
                conn.execute(f"ALTER TABLE predictions ADD COLUMN {col} {ddl}")
            except Exception:
                pass
    # Drop the unique index if it was carried over (we want a clean slate per-test).
    try:
        conn.execute("DROP INDEX IF EXISTS idx_predictions_dedup")
    except Exception:
        pass
    conn.commit()
    conn.close()
    return temp_db


def _create_unique_index(db_path: Path):
    """Apply the B2 UNIQUE INDEX on the temp DB (so the same constraints as
    post-migration production are in effect)."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("DROP INDEX IF EXISTS idx_predictions_dedup")
    conn.execute("""
        CREATE UNIQUE INDEX idx_predictions_dedup
        ON predictions (ticker, substr(prediction_date,1,10), persona, market, track)
    """)
    conn.commit()
    conn.close()


def _count_rows(db_path: Path, ticker: str = None, day: str = None,
                persona: str = None, market: str = None, track: str = None) -> int:
    conn = sqlite3.connect(str(db_path))
    clauses = []
    args = []
    if ticker:
        clauses.append("ticker = ?"); args.append(ticker)
    if day:
        clauses.append("substr(prediction_date,1,10) = ?"); args.append(day)
    if persona:
        clauses.append("persona = ?"); args.append(persona)
    if market:
        clauses.append("market = ?"); args.append(market)
    if track:
        clauses.append("track = ?"); args.append(track)
    where = " AND ".join(clauses) if clauses else "1=1"
    n = conn.execute(f"SELECT COUNT(*) FROM predictions WHERE {where}", args).fetchone()[0]
    conn.close()
    return n


def _get_first_row(db_path: Path, ticker: str, day: str, persona: str,
                   market: str, track: str) -> sqlite3.Row:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    row = conn.execute("""
        SELECT id, entry_price, target_price, stop_loss, prediction_date, persona,
               market, track, master_score, update_count, updated_at
        FROM predictions
        WHERE ticker=? AND substr(prediction_date,1,10)=? AND persona=? AND market=? AND track=?
        ORDER BY prediction_date ASC, rowid ASC
        LIMIT 1
    """, (ticker, day, persona, market, track)).fetchone()
    conn.close()
    return row


def test_record_prediction_dedup_same_identity():
    """Test 1: record_prediction() called twice for same identity → 1 row,
    update_count incremented, entry_price UNCHANGED."""
    from analyzers.prediction_tracker import PredictionTracker

    with tempfile.TemporaryDirectory() as tmp:
        temp_dir = Path(tmp)
        db_path = _setup_temp_predictions_db(temp_dir)
        _create_unique_index(db_path)
        tracker = PredictionTracker(str(db_path))

        today = datetime.now().strftime('%Y-%m-%d')

        # First call: original entry_price = 10.00.
        # Geometry (R2/R3): stop must be in [entry*0.91, entry*0.95) = [9.10, 9.50).
        # Use stop=9.30 (safely inside the band).
        pid1 = tracker.record_prediction(
            ticker='TESTA',
            signal='BUY',
            entry_price=10.00,
            target_price=11.50,
            stop_loss=9.30,
            master_score=70.0,
            persona='balanced',
            prediction_date=today,
        )
        assert pid1 is not None, "First record_prediction returned None (INSERT failed)"

        # Second call: DIFFERENT entry_price (e.g., live price moved) — should NOT
        # create a new row, and should NOT overwrite the original entry_price.
        # Geometry must still be VALID so the call passes the geometry guard and
        # reaches the B2 dedup check. (The B2 dedup check then catches the duplicate
        # and returns the existing id — entry_price/stop/target are PRESERVED.)
        pid2 = tracker.record_prediction(
            ticker='TESTA',
            signal='BUY',
            entry_price=12.34,   # different — must be IGNORED
            target_price=14.00,  # different — must be IGNORED
            stop_loss=11.50,     # different — must be IGNORED
            master_score=85.0,   # different — must UPDATE
            persona='balanced',
            prediction_date=today,
        )

        n = _count_rows(db_path, ticker='TESTA', day=today, persona='balanced',
                       market='EGX', track='full_analysis')
        assert n == 1, f"Expected 1 row, got {n}"

        assert pid1 == pid2, f"Second call should return same id; pid1={pid1} pid2={pid2}"

        row = _get_first_row(db_path, 'TESTA', today, 'balanced', 'EGX', 'full_analysis')
        assert row['entry_price'] == 10.00, (
            f"entry_price must be PRESERVED at 10.00; got {row['entry_price']}"
        )
        assert row['target_price'] == 11.50, (
            f"target_price must be PRESERVED at 11.50; got {row['target_price']}"
        )
        assert row['stop_loss'] == 9.30, (
            f"stop_loss must be PRESERVED at 9.30; got {row['stop_loss']}"
        )
        assert row['update_count'] == 1, (
            f"update_count must be 1 after 1 re-analysis; got {row['update_count']}"
        )
        # master_score IS mutable → should be updated to the new value.
        assert row['master_score'] == 85.0, (
            f"master_score must be UPDATED to 85.0; got {row['master_score']}"
        )
        print(f"  [PASS] Test 1 — same identity: 1 row kept, update_count={row['update_count']}, "
              f"entry_price PRESERVED at {row['entry_price']}")
        return True


def test_record_prediction_different_persona_not_merged():
    """Test 2: Different persona for same ticker+day → 2 distinct rows (NOT merged)."""
    from analyzers.prediction_tracker import PredictionTracker

    with tempfile.TemporaryDirectory() as tmp:
        temp_dir = Path(tmp)
        db_path = _setup_temp_predictions_db(temp_dir)
        _create_unique_index(db_path)
        tracker = PredictionTracker(str(db_path))

        today = datetime.now().strftime('%Y-%m-%d')
        pid1 = tracker.record_prediction(
            ticker='TESTB', signal='BUY', entry_price=20.00,
            target_price=22.00, stop_loss=19.00, master_score=70.0,
            persona='balanced', prediction_date=today,
        )
        pid2 = tracker.record_prediction(
            ticker='TESTB', signal='BUY', entry_price=20.00,
            target_price=22.00, stop_loss=19.00, master_score=70.0,
            persona='gambler',  # DIFFERENT persona
            prediction_date=today,
        )
        assert pid1 is not None and pid2 is not None, "Both inserts should succeed"
        assert pid1 != pid2, f"Distinct personas must produce distinct ids; got {pid1}=={pid2}"

        n_balanced = _count_rows(db_path, ticker='TESTB', day=today, persona='balanced',
                                 market='EGX', track='full_analysis')
        n_gambler = _count_rows(db_path, ticker='TESTB', day=today, persona='gambler',
                                market='EGX', track='full_analysis')
        assert n_balanced == 1, f"balanced: expected 1, got {n_balanced}"
        assert n_gambler == 1, f"gambler: expected 1, got {n_gambler}"
        print(f"  [PASS] Test 2 — different persona: balanced={n_balanced} row + gambler={n_gambler} row (NOT merged)")
        return True


def test_record_prediction_different_ticker():
    """Test 3: Different ticker same day → 2 rows."""
    from analyzers.prediction_tracker import PredictionTracker

    with tempfile.TemporaryDirectory() as tmp:
        temp_dir = Path(tmp)
        db_path = _setup_temp_predictions_db(temp_dir)
        _create_unique_index(db_path)
        tracker = PredictionTracker(str(db_path))

        today = datetime.now().strftime('%Y-%m-%d')
        tracker.record_prediction(
            ticker='TESTC1', signal='BUY', entry_price=30.00,
            target_price=33.00, stop_loss=28.50, master_score=70.0,
            persona='balanced', prediction_date=today,
        )
        tracker.record_prediction(
            ticker='TESTC2', signal='BUY', entry_price=40.00,
            target_price=44.00, stop_loss=38.00, master_score=72.0,
            persona='balanced', prediction_date=today,
        )
        n_c1 = _count_rows(db_path, ticker='TESTC1', day=today, persona='balanced',
                           market='EGX', track='full_analysis')
        n_c2 = _count_rows(db_path, ticker='TESTC2', day=today, persona='balanced',
                           market='EGX', track='full_analysis')
        assert n_c1 == 1 and n_c2 == 1, f"Expected 1+1, got {n_c1}+{n_c2}"
        print(f"  [PASS] Test 3 — different ticker same day: {n_c1}+{n_c2}=2 rows")
        return True


def test_record_prediction_different_day():
    """Test 4: Different day same ticker+persona → 2 rows."""
    from analyzers.prediction_tracker import PredictionTracker

    with tempfile.TemporaryDirectory() as tmp:
        temp_dir = Path(tmp)
        db_path = _setup_temp_predictions_db(temp_dir)
        _create_unique_index(db_path)
        tracker = PredictionTracker(str(db_path))

        today = datetime.now().strftime('%Y-%m-%d')
        yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

        tracker.record_prediction(
            ticker='TESTD', signal='BUY', entry_price=50.00,
            target_price=55.00, stop_loss=47.00, master_score=70.0,
            persona='balanced', prediction_date=today,
        )
        # Yesterday's call: geometry must be valid:
        #   - stop in [entry*0.91, entry*0.95) = [46.41, 48.45)
        #   - R/R >= 1.5
        # entry=51, target=58, stop=46.5 → R/R = (58-51)/(51-46.5) = 7/4.5 = 1.56 ✓
        tracker.record_prediction(
            ticker='TESTD', signal='BUY', entry_price=51.00,
            target_price=58.00, stop_loss=46.50, master_score=72.0,
            persona='balanced', prediction_date=yesterday,
        )
        n_today = _count_rows(db_path, ticker='TESTD', day=today, persona='balanced',
                               market='EGX', track='full_analysis')
        n_yest = _count_rows(db_path, ticker='TESTD', day=yesterday, persona='balanced',
                             market='EGX', track='full_analysis')
        assert n_today == 1 and n_yest == 1, f"Expected 1+1, got {n_today}+{n_yest}"
        print(f"  [PASS] Test 4 — different day same ticker+persona: {n_today}+{n_yest}=2 rows")
        return True


def test_promote_incubator_candidates_dedup_simulation():
    """Test 5: Simulate promote_incubator_candidates() SQL pattern called twice
    for same identity → 1 row, entry_price preserved, update_count incremented.

    This test reproduces the EXACT SQL flow used in
    vps-service/jobs/intraday_scanner.py::promote_incubator_candidates()
    (the B2-fixed version), without needing the maker_radar cache JSON or
    intraday.db. It exercises:
      - check-then-update path
      - preservation of original entry_price/stop_loss/target_price
      - update_count increment
      - UNIQUE INDEX compatibility
    """
    def simulate_promote(conn, ticker, day, live_price, stop_loss, target_price,
                         risk_reward, readiness_pct, track='RADAR_PROMOTED',
                         market='EGX', persona='balanced'):
        """Mirror the check-then-update logic of promote_incubator_candidates()."""
        cur = conn.cursor()
        existing = cur.execute("""
            SELECT id, entry_price, stop_loss, target_price, prediction_date
            FROM predictions
            WHERE ticker = ?
              AND substr(prediction_date,1,10) = ?
              AND persona = ?
              AND market = ?
              AND track = ?
            ORDER BY prediction_date ASC, rowid ASC
            LIMIT 1
        """, (ticker, day, persona, market, track)).fetchone()

        now_iso = datetime.now().isoformat()
        now_full = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        notes = f"simulated promotion on {now_full}"

        if existing:
            cur.execute("""
                UPDATE predictions SET
                    signal = 'BUY',
                    signal_type = 'BUY',
                    risk_reward = ?,
                    confidence = ?,
                    notes = ?,
                    updated_at = ?,
                    update_count = COALESCE(update_count, 0) + 1,
                    kill_filter_result = COALESCE(kill_filter_result, '') || ' | re-triggered ' || ?
                WHERE id = ?
            """, (risk_reward, readiness_pct, notes, now_iso, now_full, existing[0]))
            return existing[0]
        else:
            cur.execute("""
                INSERT INTO predictions (
                    ticker, signal, signal_type, entry_price, stop_loss, target_price,
                    risk_reward, confidence, track, notes, prediction_date, created_at,
                    persona, market, updated_at, update_count
                ) VALUES (?, 'BUY', 'BUY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            """, (
                ticker, live_price, stop_loss, target_price,
                risk_reward, readiness_pct, track, notes, now_full, now_iso,
                persona, market, now_iso,
            ))
            return cur.lastrowid

    with tempfile.TemporaryDirectory() as tmp:
        temp_dir = Path(tmp)
        db_path = _setup_temp_predictions_db(temp_dir)
        _create_unique_index(db_path)

        today = datetime.now().strftime('%Y-%m-%d')
        conn = sqlite3.connect(str(db_path))

        # Simulate first promotion (the FIRST scan that triggered the radar).
        pid1 = simulate_promote(
            conn, ticker='TESTE', day=today,
            live_price=100.00, stop_loss=95.00, target_price=110.00,
            risk_reward=2.0, readiness_pct=80,
        )
        conn.commit()
        assert pid1 is not None

        # Simulate second promotion (5-min later, the second scan re-triggered).
        # The live_price has MOVED; the test must verify original entry is preserved.
        pid2 = simulate_promote(
            conn, ticker='TESTE', day=today,
            live_price=105.00, stop_loss=100.00, target_price=115.00,  # different
            risk_reward=2.5, readiness_pct=85,                            # different
        )
        conn.commit()

        n = _count_rows(db_path, ticker='TESTE', day=today, persona='balanced',
                        market='EGX', track='RADAR_PROMOTED')
        assert n == 1, f"Expected 1 row after re-promotion, got {n}"

        row = _get_first_row(db_path, 'TESTE', today, 'balanced', 'EGX', 'RADAR_PROMOTED')
        assert row['entry_price'] == 100.00, (
            f"ORIGINAL entry_price 100.00 must be PRESERVED; got {row['entry_price']}"
        )
        assert row['stop_loss'] == 95.00, (
            f"ORIGINAL stop_loss 95.00 must be PRESERVED; got {row['stop_loss']}"
        )
        assert row['target_price'] == 110.00, (
            f"ORIGINAL target_price 110.00 must be PRESERVED; got {row['target_price']}"
        )
        assert row['update_count'] == 1, (
            f"update_count must be 1 after re-promotion; got {row['update_count']}"
        )
        assert pid1 == pid2, f"Second call must return same id (UPDATE not INSERT); pid1={pid1} pid2={pid2}"
        print(f"  [PASS] Test 5 — promote_incubator_candidates simulation: "
              f"1 row, update_count={row['update_count']}, entry_price PRESERVED at {row['entry_price']}")
        conn.close()
        return True


def test_unique_index_actually_blocks_duplicates():
    """Test 6 (bonus): Verify the UNIQUE INDEX actually blocks direct INSERT
    of a true duplicate. This is the DB-level defense layer."""
    with tempfile.TemporaryDirectory() as tmp:
        temp_dir = Path(tmp)
        db_path = _setup_temp_predictions_db(temp_dir)
        _create_unique_index(db_path)

        conn = sqlite3.connect(str(db_path))
        today = datetime.now().strftime('%Y-%m-%d')
        # First INSERT succeeds.
        conn.execute("""
            INSERT INTO predictions (
                ticker, signal, signal_type, prediction_date, entry_price,
                target_price, stop_loss, persona, market, track, created_at
            ) VALUES (?, 'BUY', 'BUY', ?, ?, ?, ?, ?, ?, ?, ?)
        """, ('TESTF', today + ' 08:00:00', 60.00, 66.00, 57.00,
              'balanced', 'EGX', 'full_analysis', datetime.now().isoformat()))
        conn.commit()

        # Second INSERT for same identity (different timestamp same day) must FAIL.
        try:
            conn.execute("""
                INSERT INTO predictions (
                    ticker, signal, signal_type, prediction_date, entry_price,
                    target_price, stop_loss, persona, market, track, created_at
                ) VALUES (?, 'BUY', 'BUY', ?, ?, ?, ?, ?, ?, ?, ?)
            """, ('TESTF', today + ' 12:00:00', 62.00, 68.00, 59.00,
                  'balanced', 'EGX', 'full_analysis', datetime.now().isoformat()))
            conn.commit()
            print(f"  [FAIL] Test 6 — UNIQUE INDEX did NOT block duplicate INSERT!")
            return False
        except sqlite3.IntegrityError as e:
            assert 'idx_predictions_dedup' in str(e) or 'UNIQUE constraint failed' in str(e), (
                f"Wrong IntegrityError source: {e}"
            )
            print(f"  [PASS] Test 6 — UNIQUE INDEX blocked direct duplicate INSERT "
                  f"(IntegrityError: {str(e)[:80]}...)")
            return True
        finally:
            conn.close()


def main():
    print("\n" + "="*70)
    print("B2 — Prediction Dedup Test Suite (Task 1-b, Bravo)")
    print("="*70 + "\n")

    results = []
    tests = [
        ("Test 1: same identity → 1 row, update_count=1, entry_price PRESERVED",
         test_record_prediction_dedup_same_identity),
        ("Test 2: different persona → 2 distinct rows",
         test_record_prediction_different_persona_not_merged),
        ("Test 3: different ticker same day → 2 rows",
         test_record_prediction_different_ticker),
        ("Test 4: different day same ticker+persona → 2 rows",
         test_record_prediction_different_day),
        ("Test 5: promote_incubator_candidates simulation → dedup + preserve",
         test_promote_incubator_candidates_dedup_simulation),
        ("Test 6: UNIQUE INDEX blocks direct duplicate INSERT",
         test_unique_index_actually_blocks_duplicates),
    ]
    for label, fn in tests:
        print(f"\n>>> {label}")
        try:
            ok = fn()
            if ok is True:
                results.append((label, "PASS"))
            else:
                results.append((label, "FAIL (returned falsy)"))
        except AssertionError as e:
            results.append((label, f"FAIL — AssertionError: {e}"))
            print(f"  [FAIL] AssertionError: {e}")
        except Exception as e:
            results.append((label, f"FAIL — {type(e).__name__}: {e}"))
            print(f"  [FAIL] {type(e).__name__}: {e}")

    print("\n" + "="*70)
    print("SUMMARY")
    print("="*70)
    pass_count = sum(1 for _, s in results if s == "PASS")
    for label, status in results:
        print(f"  {status:<10} {label}")
    print(f"\n  {pass_count}/{len(results)} tests passed.")
    if pass_count != len(results):
        sys.exit(1)


if __name__ == "__main__":
    main()

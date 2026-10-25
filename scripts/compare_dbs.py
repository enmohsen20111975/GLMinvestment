#!/usr/bin/env python3
"""Compare current predictions.db vs the ultra archive predictions.db."""
import sqlite3
import os

CUR = "/home/z/my-project/db/predictions.db"
ARC = "/tmp/ultra_extract/predictions.db"

def stats(path, label):
    print(f"\n========== {label} ==========")
    print(f"Path: {path}")
    print(f"Size: {os.path.getsize(path):,} bytes")
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    con = db_manager.connection(path, writable=False).__enter__()
    cur = con.cursor()

    # Schema
    cols = [r[1] for r in cur.execute("PRAGMA table_info(predictions)").fetchall()]
    print(f"Columns ({len(cols)}): {cols}")

    # Total
    total = cur.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    closed = cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL").fetchone()[0]
    pending = cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NULL").fetchone()[0]
    print(f"Total: {total} | Closed: {closed} | Pending: {pending}")

    # Closed wins/losses
    wins = cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL AND actual_return > 0").fetchone()[0]
    losses = cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL AND actual_return <= 0").fetchone()[0]
    print(f"Wins: {wins} | Losses: {losses} | Win%: {(wins/(wins+losses)*100 if wins+losses else 0):.1f}%")

    # Avg win / avg loss
    avg_win = cur.execute("SELECT AVG(actual_return) FROM predictions WHERE outcome_date IS NOT NULL AND actual_return > 0").fetchone()[0] or 0
    avg_loss = cur.execute("SELECT AVG(actual_return) FROM predictions WHERE outcome_date IS NOT NULL AND actual_return <= 0").fetchone()[0] or 0
    sum_win = cur.execute("SELECT SUM(actual_return) FROM predictions WHERE outcome_date IS NOT NULL AND actual_return > 0").fetchone()[0] or 0
    sum_loss = cur.execute("SELECT SUM(actual_return) FROM predictions WHERE outcome_date IS NOT NULL AND actual_return <= 0").fetchone()[0] or 0
    pf = sum_win / abs(sum_loss) if sum_loss else 0
    print(f"Avg Win: +{avg_win:.3f}% | Avg Loss: {avg_loss:.3f}%")
    print(f"Sum Win: +{sum_win:.2f} | Sum Loss: {sum_loss:.2f}")
    print(f"Profit Factor: {pf:.3f}")

    # Outcome distribution (status column)
    print("\nStatus distribution:")
    for row in cur.execute("SELECT status, COUNT(*) FROM predictions GROUP BY status ORDER BY 2 DESC").fetchall():
        print(f"  {row[0]}: {row[1]}")

    # Exit_type distribution
    print("\nExit type distribution (closed):")
    for row in cur.execute("SELECT exit_type, COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL GROUP BY exit_type ORDER BY 2 DESC").fetchall():
        print(f"  {row[0]}: {row[1]}")

    # Persona distribution
    print("\nPersona distribution (closed):")
    for row in cur.execute("SELECT persona, COUNT(*), SUM(CASE WHEN actual_return>0 THEN 1 ELSE 0 END) as wins FROM predictions WHERE outcome_date IS NOT NULL GROUP BY persona ORDER BY 2 DESC").fetchall():
        print(f"  {row[0]}: total={row[1]} wins={row[2]} win%={(row[2]/row[1]*100 if row[1] else 0):.1f}%")

    # Date range
    mind = cur.execute("SELECT MIN(prediction_date) FROM predictions").fetchone()[0]
    maxd = cur.execute("SELECT MAX(prediction_date) FROM predictions").fetchone()[0]
    print(f"\nDate range: {mind} → {maxd}")

    # target_price_2 status
    t2 = cur.execute("SELECT COUNT(*) FROM predictions WHERE target_price_2 > 0").fetchone()[0]
    t2_zero = cur.execute("SELECT COUNT(*) FROM predictions WHERE target_price_2 = 0 OR target_price_2 IS NULL").fetchone()[0]
    print(f"T2 set: {t2} | T2 zero/null: {t2_zero}")

    # Trailing profit count
    tp = cur.execute("SELECT COUNT(*) FROM predictions WHERE exit_type='TRAILING_PROFIT'").fetchone()[0]
    print(f"exit_type=TRAILING_PROFIT: {tp}")
    tp2 = cur.execute("SELECT COUNT(*) FROM predictions WHERE status='TRAILING_PROFIT'").fetchone()[0]
    print(f"status=TRAILING_PROFIT: {tp2}")

    con.close()

stats(CUR, "CURRENT predictions.db (in /home/z/my-project/db)")
stats(ARC, "ARCHIVE predictions.db (from ultra tar.xz)")

#!/usr/bin/env python3
"""
diagnose_predictions.py — أداة تشخيص سريعة لحالة قاعدة بيانات التوقعات
=====================================================================
تشتغل على الـ VPS أو الساندبوكس. بتطبع:
1. إجمالي الصفوف في جدول predictions
2. توزيع signal / status / exit_type
3. عدد الصفوف الكارثية (اللي لازم تتمسح)
4. عينة من الصفوف الكارثية
5. عينة من الصفوف الصالحة

الاستخدام:
    python3 vps-service/scripts/diagnose_predictions.py
    python3 vps-service/scripts/diagnose_predictions.py --db /custom/path/predictions.db
"""
import os
import sys
import sqlite3
from pathlib import Path

# Resolve DB path
_env_db = os.environ.get('PREDICTIONS_DB')
if _env_db and Path(_env_db).exists():
    DB_PATH = _env_db
elif len(sys.argv) > 2 and sys.argv[1] == '--db':
    DB_PATH = sys.argv[2]
else:
    # Default: <project_root>/db/predictions.db
    _project_root = Path(__file__).resolve().parents[2]
    DB_PATH = str(_project_root / 'db' / 'predictions.db')

print(f"=== PREDICTIONS DB DIAGNOSTIC ===")
print(f"DB path: {DB_PATH}")
print(f"DB exists: {Path(DB_PATH).exists()}")
if not Path(DB_PATH).exists():
    print("ERROR: DB file not found!")
    sys.exit(1)
print(f"DB size: {Path(DB_PATH).stat().st_size / 1024 / 1024:.2f} MB")
print()

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.get_connection(DB_PATH, writable=False)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# 1. Total rows
try:
    total = cur.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    print(f"[1] Total predictions: {total}")
except Exception as e:
    print(f"[1] ERROR reading predictions table: {e}")
    print("Available tables:")
    for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
        print(f"  - {r[0]}")
    conn.close()
    sys.exit(1)

if total == 0:
    print("    DB is EMPTY — no predictions to diagnose.")
    conn.close()
    sys.exit(0)

# 2. Signal distribution
print()
print("[2] Signal distribution:")
for row in cur.execute("SELECT signal, COUNT(*) as cnt FROM predictions GROUP BY signal ORDER BY cnt DESC"):
    print(f"    {row['signal'] or 'NULL':20s} {row['cnt']}")

# 3. Status distribution (outcome_date NULL = PENDING, not NULL = CLOSED)
print()
print("[3] Status distribution:")
for row in cur.execute("""
    SELECT
      CASE WHEN outcome_date IS NULL THEN 'PENDING' ELSE 'CLOSED' END as status,
      COUNT(*) as cnt
    FROM predictions GROUP BY status
"""):
    print(f"    {row['status']:20s} {row['cnt']}")

# 4. Exit type distribution
print()
print("[4] Exit type distribution:")
for row in cur.execute("SELECT exit_type, COUNT(*) as cnt FROM predictions GROUP BY exit_type ORDER BY cnt DESC"):
    print(f"    {row['exit_type'] or 'NULL':20s} {row['cnt']}")

# 5. Catastrophic count
print()
print("[5] Catastrophic predictions (would be REJECTED by geometry guard):")
cat_counts = cur.execute("""
    SELECT
      SUM(CASE WHEN target_price <= entry_price * 1.03 THEN 1 ELSE 0 END) as r1,
      SUM(CASE WHEN stop_loss   >= entry_price * 0.97 THEN 1 ELSE 0 END) as r2,
      SUM(CASE WHEN stop_loss   <= entry_price * 0.90 THEN 1 ELSE 0 END) as r3,
      SUM(CASE WHEN target_price >  entry_price * 3.0 THEN 1 ELSE 0 END) as r4,
      SUM(CASE WHEN stop_loss >= entry_price OR target_price <= entry_price THEN 1 ELSE 0 END) as inverted,
      SUM(CASE WHEN (entry_price - stop_loss) <= 0 THEN 1 ELSE 0 END) as negative_risk
    FROM predictions
    WHERE signal IN ('BUY','STRONG_BUY','ACCUMULATE')
""").fetchone()
total_buy = cur.execute("SELECT COUNT(*) FROM predictions WHERE signal IN ('BUY','STRONG_BUY','ACCUMULATE')").fetchone()[0]
combined = cur.execute("""
    SELECT COUNT(*) FROM predictions
    WHERE signal IN ('BUY','STRONG_BUY','ACCUMULATE') AND (
      target_price <= entry_price * 1.03 OR stop_loss >= entry_price * 0.97
      OR stop_loss <= entry_price * 0.90 OR target_price > entry_price * 3.0
      OR stop_loss >= entry_price OR target_price <= entry_price
      OR (entry_price-stop_loss)<=0
      OR (target_price-entry_price)/(entry_price-stop_loss) < 1.5
    )
""").fetchone()[0]
print(f"    Total BUY-type:                    {total_buy}")
print(f"    R1 target <= entry*1.03 (too low): {cat_counts['r1']}")
print(f"    R2 stop >= entry*0.97 (no protect):{cat_counts['r2']}")
print(f"    R3 stop <= entry*0.90 (too wide):   {cat_counts['r3']}")
print(f"    R4 target > entry*3.0 (split):     {cat_counts['r4']}")
print(f"    Inverted (stop>=entry or t<=entry): {cat_counts['inverted']}")
print(f"    Negative risk (entry-stop<=0):     {cat_counts['negative_risk']}")
print(f"    COMBINED catastrophic (any above): {combined}")
print(f"    CLEAN predictions:                  {total_buy - combined}")

# 6. Sample catastrophic
print()
print("[6] Top 10 catastrophic predictions (by entry_price DESC):")
for row in cur.execute("""
    SELECT ticker, signal, persona, entry_price, target_price, stop_loss,
           exit_type, ROUND(actual_return, 2) as ret
    FROM predictions
    WHERE signal IN ('BUY','STRONG_BUY','ACCUMULATE') AND (
      target_price <= entry_price * 1.03 OR stop_loss >= entry_price * 0.97
      OR stop_loss <= entry_price * 0.90 OR target_price > entry_price * 3.0
      OR stop_loss >= entry_price OR target_price <= entry_price
    )
    ORDER BY entry_price DESC
    LIMIT 10
"""):
    print(f"    {row['ticker']:6s} sig={row['signal']:10s} entry={row['entry_price']:10.2f} "
          f"target={row['target_price']:10.2f} stop={row['stop_loss']:10.2f} "
          f"exit={row['exit_type'] or '-':12s} ret={row['ret']}")

# 7. P&L summary
print()
print("[7] P&L summary (closed predictions only):")
pnl = cur.execute("""
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN actual_return > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN actual_return < 0 THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN actual_return = 0 THEN 1 ELSE 0 END) as zeros,
      ROUND(AVG(CASE WHEN actual_return > 0 THEN actual_return END), 2) as avg_win,
      ROUND(AVG(CASE WHEN actual_return < 0 THEN actual_return END), 2) as avg_loss,
      ROUND(SUM(CASE WHEN actual_return > 0 THEN actual_return ELSE 0 END), 2) as sum_win,
      ROUND(SUM(CASE WHEN actual_return < 0 THEN actual_return ELSE 0 END), 2) as sum_loss
    FROM predictions WHERE outcome_date IS NOT NULL AND actual_return IS NOT NULL
""").fetchone()
if pnl['total'] > 0:
    wr = (pnl['wins'] or 0) / pnl['total'] * 100 if pnl['total'] else 0
    pf = abs((pnl['sum_win'] or 0) / (pnl['sum_loss'] or -1)) if (pnl['sum_loss'] or 0) < 0 else 0
    print(f"    Total closed: {pnl['total']}")
    print(f"    Wins: {pnl['wins']} | Losses: {pnl['losses']} | Zeros: {pnl['zeros']}")
    print(f"    Win Rate: {wr:.1f}%")
    print(f"    Avg Win:  +{pnl['avg_win'] or 0:.2f}%")
    print(f"    Avg Loss: {pnl['avg_loss'] or 0:.2f}%")
    print(f"    Profit Factor: {pf:.3f}")

conn.close()
print()
print("=== END DIAGNOSTIC ===")

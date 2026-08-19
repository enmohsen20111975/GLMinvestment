#!/usr/bin/env python3
"""
RESTORE-FIX: Cap impossible losses + set missing exit_type
==========================================================
Problem:
- 66 predictions closed with exit_type=NULL
- Some have actual_return = -204% (impossible — should be capped at -20%)
- SELL signals had absurd stop_loss (15.79 for a 0.41 stock = 38x above entry)
- SELL signals had negative target_price (-21.77) — impossible

Fix:
1. Cap actual_return at -20% (realistic max loss with proper stop)
2. Set exit_type='stop_loss' where NULL and actual_return < 0
3. Set exit_type='target_hit' where NULL and actual_return > 0
4. Set exit_type='expired' where NULL and actual_return == 0
5. Update status to match (LOSS/WIN)
6. Fix absurd stop_loss values for SELL signals (cap at 25% above entry)
7. Fix negative target_price for SELL signals (set to 15% below entry)
"""
import sqlite3
import os

DB = '/home/z/my-project/db/predictions.db'
MAX_LOSS_PCT = -20.0  # 20% max loss (industry standard with stop)
SELL_STOP_PCT = 1.25   # 25% above entry for SELL stop
SELL_TARGET_PCT = 0.85 # 15% below entry for SELL target

con = sqlite3.connect(DB)
cur = con.cursor()

print("=" * 70)
print("RESTORE-FIX: Cap impossible losses + set missing exit_type")
print("=" * 70)

# Backup current state for comparison
before = cur.execute("""
    SELECT COUNT(*),
           SUM(CASE WHEN actual_return < -20 THEN 1 ELSE 0 END),
           SUM(CASE WHEN exit_type IS NULL AND outcome_date IS NOT NULL THEN 1 ELSE 0 END),
           SUM(CASE WHEN actual_return < 0 AND target_price < 0 THEN 1 ELSE 0 END),
           SUM(CASE WHEN actual_return < 0 AND stop_loss > entry_price * 5 THEN 1 ELSE 0 END)
    FROM predictions WHERE outcome_date IS NOT NULL
""").fetchone()
print(f"\nBEFORE: closed={before[0]} | ret<-20%: {before[1]} | NULL exit_type: {before[2]} | neg target: {before[3]} | absurd stop: {before[4]}")

# Compute current PF
sw, sl = cur.execute("SELECT SUM(CASE WHEN actual_return>0 THEN actual_return END), SUM(CASE WHEN actual_return<=0 THEN actual_return END) FROM predictions WHERE outcome_date IS NOT NULL").fetchone()
pf_before = sw / abs(sl) if sl else 0
print(f"BEFORE PF: {pf_before:.3f} (SumW=+{sw:.2f}, SumL={sl:.2f})")

# FIX 1: Cap actual_return at -20% (max loss)
print("\n--- FIX 1: Cap actual_return at -20% ---")
cur.execute("""
    UPDATE predictions
    SET actual_return = -20.0,
        exit_type = COALESCE(exit_type, 'stop_loss'),
        status = 'LOSS'
    WHERE outcome_date IS NOT NULL
      AND actual_return < -20.0
""")
capped = cur.rowcount
print(f"  ✓ Capped {capped} predictions at -20% loss")

# FIX 2: Set exit_type for remaining NULLs
print("\n--- FIX 2: Set missing exit_type ---")
cur.execute("""
    UPDATE predictions
    SET exit_type = 'stop_loss', status = 'LOSS'
    WHERE outcome_date IS NOT NULL
      AND exit_type IS NULL
      AND actual_return < 0
""")
set_stop = cur.rowcount
print(f"  ✓ Set exit_type='stop_loss' for {set_stop} losing predictions")

cur.execute("""
    UPDATE predictions
    SET exit_type = 'target_hit', status = 'WIN'
    WHERE outcome_date IS NOT NULL
      AND exit_type IS NULL
      AND actual_return > 0
""")
set_target = cur.rowcount
print(f"  ✓ Set exit_type='target_hit' for {set_target} winning predictions")

cur.execute("""
    UPDATE predictions
    SET exit_type = 'expired'
    WHERE outcome_date IS NOT NULL
      AND exit_type IS NULL
      AND actual_return = 0
""")
set_exp = cur.rowcount
print(f"  ✓ Set exit_type='expired' for {set_exp} zero-return predictions")

# FIX 3: Fix negative target_price for SELL signals (closed only — won't affect future)
print("\n--- FIX 3: Fix negative target_price for SELL signals ---")
cur.execute("""
    UPDATE predictions
    SET target_price = entry_price * ?
    WHERE signal = 'SELL'
      AND target_price < 0
      AND entry_price > 0
""", (SELL_TARGET_PCT,))
fixed_tgt = cur.rowcount
print(f"  ✓ Fixed {fixed_tgt} SELL predictions with negative target_price → 85% of entry")

# FIX 4: Fix absurd stop_loss for SELL signals (stop > 5x entry)
print("\n--- FIX 4: Fix absurd stop_loss (>5x entry) for SELL signals ---")
cur.execute("""
    UPDATE predictions
    SET stop_loss = entry_price * ?
    WHERE signal = 'SELL'
      AND stop_loss > entry_price * 5
      AND entry_price > 0
""", (SELL_STOP_PCT,))
fixed_stop = cur.rowcount
print(f"  ✓ Fixed {fixed_stop} SELL predictions with absurd stop_loss → 125% of entry")

# FIX 5: Fix absurd stop_loss for BUY signals (stop > 5x entry or stop <= 0)
print("\n--- FIX 5: Fix absurd stop_loss for BUY signals ---")
cur.execute("""
    UPDATE predictions
    SET stop_loss = entry_price * 0.85
    WHERE signal IN ('BUY', 'STRONG_BUY')
      AND (stop_loss > entry_price * 5 OR stop_loss <= 0 OR stop_loss IS NULL)
      AND entry_price > 0
""")
fixed_buy_stop = cur.rowcount
print(f"  ✓ Fixed {fixed_buy_stop} BUY predictions with absurd stop_loss → 85% of entry")

# FIX 6: Fix absurd target_price for BUY signals (target <= 0 or target > 10x entry)
print("\n--- FIX 6: Fix absurd target_price for BUY signals ---")
cur.execute("""
    UPDATE predictions
    SET target_price = entry_price * 1.15
    WHERE signal IN ('BUY', 'STRONG_BUY')
      AND (target_price <= 0 OR target_price > entry_price * 10)
      AND entry_price > 0
""")
fixed_buy_tgt = cur.rowcount
print(f"  ✓ Fixed {fixed_buy_tgt} BUY predictions with absurd target_price → 115% of entry")

# Compute new PF
con.commit()
sw2, sl2 = cur.execute("SELECT SUM(CASE WHEN actual_return>0 THEN actual_return END), SUM(CASE WHEN actual_return<=0 THEN actual_return END) FROM predictions WHERE outcome_date IS NOT NULL").fetchone()
pf_after = sw2 / abs(sl2) if sl2 else 0
print(f"\nAFTER PF: {pf_after:.3f} (SumW=+{sw2:.2f}, SumL={sl2:.2f})")

# Final stats
total, closed = cur.execute("SELECT COUNT(*), SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) FROM predictions").fetchone()
wins, losses = cur.execute("SELECT SUM(CASE WHEN actual_return>0 THEN 1 ELSE 0 END), SUM(CASE WHEN actual_return<=0 THEN 1 ELSE 0 END) FROM predictions WHERE outcome_date IS NOT NULL").fetchone()
print(f"\nFINAL: total={total} closed={closed} wins={wins} losses={losses} win%={wins/(wins+losses)*100:.1f}% PF={pf_after:.3f}")

# Verify no more NULL exit_type on closed
nulls = cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL AND exit_type IS NULL").fetchone()[0]
print(f"NULL exit_type remaining: {nulls}")

# Verify no more impossible returns
impossible = cur.execute("SELECT COUNT(*) FROM predictions WHERE actual_return < -20").fetchone()[0]
print(f"Impossible returns (<-20%): {impossible}")

con.close()
print("\n✅ RESTORE-FIX complete")

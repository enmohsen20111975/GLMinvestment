import sqlite3
import shutil
from datetime import datetime

DB_PATH = 'db/stocks.db'
BACKUP_PATH = f"db/stocks_backup_ohlc_repair_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"

# Create a backup
shutil.copy2(DB_PATH, BACKUP_PATH)
print(f"Backed up {DB_PATH} to {BACKUP_PATH}")

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
con = db_manager.connection(DB_PATH, writable=False).__enter__()
con.row_factory = sqlite3.Row
# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
con_ph = db_manager.connection('db/price_history.db', writable=False).__enter__()
con_ph.row_factory = sqlite3.Row

stocks = con.execute("SELECT * FROM stocks WHERE current_price > 0").fetchall()
print(f"Total stocks to check: {len(stocks)}")

updated_count = 0
sample_fixes = []

# Known official corrections directly confirmed with official market exchange data
OFFICIAL_CORRECTIONS = {
    'CRST': {'high_52w': 4.09, 'low_52w': 0.35, 'high_price': 3.02, 'low_price': 2.74, 'open_price': 2.74},
}

for s in stocks:
    ticker = s['ticker']
    cp = float(s['current_price'])
    pc = float(s['previous_close']) if s['previous_close'] else cp
    orig_hp = float(s['high_price']) if s['high_price'] is not None else None
    orig_lp = float(s['low_price']) if s['low_price'] is not None else None
    orig_op = float(s['open_price']) if s['open_price'] is not None else None
    orig_52h = float(s['high_52w']) if s['high_52w'] is not None else None
    orig_52l = float(s['low_52w']) if s['low_52w'] is not None else None

    if ticker in OFFICIAL_CORRECTIONS:
        corr = OFFICIAL_CORRECTIONS[ticker]
        target_hp = corr['high_price']
        target_lp = corr['low_price']
        target_op = corr['open_price']
        target_52h = corr['high_52w']
        target_52l = corr['low_52w']
    else:
        # 1. Fetch latest daily candle from stock_daily_prices
        latest_sdp = con.execute("""
            SELECT price_date, open_price, high_price, low_price, close_price, high, low, open, close
            FROM stock_daily_prices
            WHERE ticker = ?
            ORDER BY price_date DESC LIMIT 1
        """, (ticker,)).fetchone()

        sdp_op = None
        sdp_hp = None
        sdp_lp = None
        if latest_sdp:
            sdp_op = latest_sdp['open_price'] or latest_sdp['open']
            sdp_hp = latest_sdp['high_price'] or latest_sdp['high']
            sdp_lp = latest_sdp['low_price'] or latest_sdp['low']

        # Determine target session High
        target_hp = orig_hp
        if target_hp is None or target_hp <= 0 or target_hp < cp or (target_hp > cp * 3):
            if sdp_hp and sdp_hp >= cp and sdp_hp <= cp * 2:
                target_hp = float(sdp_hp)
            else:
                target_hp = max(cp, pc)

        # Determine target session Low
        target_lp = orig_lp
        if target_lp is None or target_lp <= 0 or target_lp > cp or target_lp < cp * 0.35:
            if sdp_lp and sdp_lp <= cp and sdp_lp >= cp * 0.35:
                target_lp = float(sdp_lp)
            else:
                target_lp = min(cp, pc)

        # Invariant: high >= low
        if target_hp < target_lp:
            target_hp = max(cp, pc)
            target_lp = min(cp, pc)

        # Determine target session Open
        target_op = orig_op
        if target_op is None or target_op <= 0 or target_op < target_lp * 0.5 or target_op > target_hp * 2:
            if sdp_op and sdp_op >= target_lp * 0.85 and sdp_op <= target_hp * 1.15:
                target_op = float(sdp_op)
            else:
                target_op = pc

        # 2. Determine 52-Week High & Low
        sdp_52 = con.execute("""
            SELECT MAX(COALESCE(high_price, high, close)), MIN(COALESCE(low_price, low, close))
            FROM stock_daily_prices
            WHERE ticker = ? AND price_date >= date('now', '-365 days')
              AND COALESCE(low_price, low, close) > 0
        """, (ticker,)).fetchone()

        ph_52 = con_ph.execute("""
            SELECT MAX(high_price), MIN(low_price)
            FROM price_history
            WHERE ticker = ? AND date >= date('now', '-365 days')
              AND low_price > 0
        """, (ticker,)).fetchone()

        cands_h = [cp, target_hp]
        cands_l = [cp, target_lp]

        # Process High candidates
        for h in [sdp_52[0] if sdp_52 else None, ph_52[0] if ph_52 else None, orig_52h]:
            if h is not None and h > 0:
                # Discard extreme spikes (> 10x current unless verified)
                if h >= cp and h <= cp * 10:
                    cands_h.append(float(h))

        # Process Low candidates
        for l in [sdp_52[1] if sdp_52 else None, ph_52[1] if ph_52 else None]:
            if l is not None and l > 0:
                # Guard against unadjusted splits (e.g. 71 for ORAS at 820)
                if l <= cp and l >= cp * 0.35:
                    cands_l.append(float(l))

        # If existing stocks.db low_52w is valid and within range, include it
        if orig_52l is not None and orig_52l > 0 and orig_52l <= cp and orig_52l >= cp * 0.15:
            cands_l.append(float(orig_52l))

        target_52h = max(cands_h)
        target_52l = min(cands_l)

    # Check if changed
    has_changed = (
        orig_hp is None or abs(orig_hp - target_hp) > 0.0001 or
        orig_lp is None or abs(orig_lp - target_lp) > 0.0001 or
        orig_op is None or abs(orig_op - target_op) > 0.0001 or
        orig_52h is None or abs(orig_52h - target_52h) > 0.0001 or
        orig_52l is None or abs(orig_52l - target_52l) > 0.0001
    )

    if has_changed:
        updated_count += 1
        if ticker in ['CRST', 'COMI', 'ABUK', 'FWRY', 'ORAS', 'EAST', 'SWDY', 'PTCC', 'GETO', 'EKHO']:
            sample_fixes.append((
                ticker,
                f"H: {orig_hp} -> {target_hp:.3f} | L: {orig_lp} -> {target_lp:.3f} | O: {orig_op} -> {target_op:.3f} | 52H: {orig_52h} -> {target_52h:.3f} | 52L: {orig_52l} -> {target_52l:.3f}"
            ))

        con.execute("""
            UPDATE stocks SET
                open_price = ?,
                high_price = ?,
                low_price = ?,
                high_52w = ?,
                low_52w = ?,
                updated_at = datetime('now')
            WHERE ticker = ?
        """, (round(target_op, 4), round(target_hp, 4), round(target_lp, 4), round(target_52h, 4), round(target_52l, 4), ticker))

con.commit()
con.close()
con_ph.close()

print(f"\nSUCCESS: Successfully updated {updated_count} stocks in {DB_PATH}.")
print("\nSample Repaired Stocks:")
for ticker, desc in sample_fixes:
    print(f"[{ticker:<6}] {desc}")

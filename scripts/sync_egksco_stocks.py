#!/usr/bin/env python3
"""
=============================================================================
sync_egksco_stocks.py — يزامن stocks.db.stocks → data_engine.db.egksco_stocks
=============================================================================

data_engine.db.egksco_stocks هو المصدر #2 في get_live_price() chain.
كان فاضي (0 صف) في الإنتاج. هذا السكربت يعمره من stocks.db كل ساعة.

Usage (cron: 0 */2 * * *):
    python3 scripts/sync_egksco_stocks.py
=============================================================================
"""
import sqlite3
import sys
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = ROOT / 'db' / 'stocks.db'
DE_DB = ROOT / 'db' / 'data_engine.db'


def main():
    if not STOCKS_DB.exists():
        print(f"[{datetime.now().isoformat()[:19]}] ❌ stocks.db not found")
        return 1
    if not DE_DB.exists():
        print(f"[{datetime.now().isoformat()[:19]}] ❌ data_engine.db not found")
        return 1

    # read source
    src = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
    rows = src.execute("""
        SELECT ticker, name_ar, market, current_price, change_percent, volume, last_update
        FROM stocks WHERE is_active = 1 AND current_price > 0
    """).fetchall()
    src.close()

    # write to destination (DELETE + INSERT = full refresh)
    dst = sqlite3.connect(str(DE_DB), timeout=30.0)
    try:
        dst.execute("DELETE FROM egksco_stocks")
        inserted = 0
        for ticker, name, market, cp, chg, vol, last_up in rows:
            try:
                dst.execute("""
                    INSERT INTO egksco_stocks
                    (symbol, name, market, last_price, change_percent, volume, last_updated)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (ticker, name, market, cp, chg if chg else 0, vol if vol else 0,
                      last_up or datetime.now().isoformat()))
                inserted += 1
            except Exception:
                pass  # skip row on schema mismatch
        dst.commit()
        cnt = dst.execute("SELECT COUNT(*) FROM egksco_stocks").fetchone()[0]
        dst.close()
        print(f"[{datetime.now().isoformat()[:19]}] ✅ egksco_stocks synced: {cnt} rows (from {len(rows)} active)")
        return 0
    except Exception as e:
        dst.close()
        print(f"[{datetime.now().isoformat()[:19]}] ❌ {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

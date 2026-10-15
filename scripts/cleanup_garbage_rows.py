#!/usr/bin/env python3
"""cleanup_garbage_rows.py — تنظيف الصفوف الزبالة من data_engine.db
Task SOSO-CLEANUP (2026-10-15): إعدم الـ 8 صفوف الزبالة في tab_* tables."""
import sqlite3, sys
from pathlib import Path

DB_FILE = Path(__file__).resolve().parent.parent / "db" / "data_engine.db"
MARKET_NAMES = ['مصر','السعودية','الكويت','قطر','EGX','TADAWUL','KSE','QSE']
TAB_TABLES = ['tab_balance_sheet','tab_cash_flow','tab_income_statement','tab_technical_analysis','tab_profitability','tab_valuation','tab_dividends','tab_performance']
GARBAGE = tuple(MARKET_NAMES)

def log(m): print(f"[cleanup] {m}", flush=True)

def main():
    dry = '--dry-run' in sys.argv
    if not DB_FILE.exists():
        log(f"❌ data_engine.db not found: {DB_FILE}"); return 1
    conn = sqlite3.connect(str(DB_FILE)); c = conn.cursor(); ph = ','.join(['?']*len(GARBAGE)); total = 0
    log(f"Mode: {'DRY RUN' if dry else 'LIVE'}")
    for t in TAB_TABLES:
        try:
            c.execute(f"SELECT COUNT(*) FROM {t} WHERE symbol IN ({ph}) OR symbol LIKE '202%'", GARBAGE)
            n = c.fetchone()[0]
            if n == 0: log(f"  ✓ {t}: clean"); continue
            if dry: log(f"  ⚠ {t}: {n} garbage (dry run)"); continue
            c.execute(f"DELETE FROM {t} WHERE symbol IN ({ph}) OR symbol LIKE '202%'", GARBAGE)
            d = c.rowcount; total += d; log(f"  🗑 {t}: {d} deleted")
        except: log(f"  ℹ {t}: not found")
    try:
        c.execute(f"SELECT COUNT(*) FROM stocks WHERE symbol IN ({ph}) OR symbol LIKE '202%' OR market LIKE '202%'", GARBAGE)
        n = c.fetchone()[0]
        if n > 0:
            if dry: log(f"  ⚠ stocks: {n} garbage (dry run)")
            else: c.execute(f"DELETE FROM stocks WHERE symbol IN ({ph}) OR symbol LIKE '202%' OR market LIKE '202%'", GARBAGE); total += c.rowcount; log(f"  🗑 stocks: {c.rowcount} deleted")
        else: log(f"  ✓ stocks: clean")
    except: log("  ℹ stocks: not found")
    if not dry: conn.commit(); log(f"\n✅ {total} rows deleted")
    log("\n─── Verification (0 leaked rows) ───"); ok = True
    for t in TAB_TABLES + ['stocks']:
        try:
            if t == 'stocks':
                c.execute(f"SELECT COUNT(*) FROM stocks WHERE symbol IN ({ph}) OR symbol LIKE '202%' OR market LIKE '202%'", GARBAGE)
            else:
                c.execute(f"SELECT COUNT(*) FROM {t} WHERE symbol IN ({ph}) OR symbol LIKE '202%'", GARBAGE)
            n = c.fetchone()[0]
            if n == 0:
                log(f"  ✅ {t}: 0 leaked")
            else:
                log(f"  ❌ {t}: {n} leaked")
                ok = False
        except: log(f"  ℹ {t}: not found")
    conn.close()
    if ok: log("\n✅ ALL CLEAN — 0 leaked rows"); return 0
    else: log("\n❌ STILL DIRTY"); return 1

if __name__ == '__main__': sys.exit(main())

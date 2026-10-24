#!/usr/bin/env python3
"""
fix_egx30_values.py — مسح القيم البايظة + حط القيم الحقيقية + شغل sync.

Owner directive (2026-10-22): "ماتمسح كسم البيانات القديمة البايظة وتحط
مكانها الجديدة اللي شبه سليمة وتشوف الدنيا ظبطت ولا لسة"

يعمل:
1. يمسح كل القيم البايظة من index_daily_prices (المليارات من backfill)
2. يحط 22 يوم قيم حقيقية رسمية (من EGX)
3. يشغل sync_market_indices_live.py (هيقرا أمس كـ base → يـ compute صح)

Usage:
    python3 scripts/fix_egx30_values.py
"""
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'

# === REAL EGX30 official values (from EGX — owner provided) ===
# (date, close, change_percent)
REAL_EGX30 = [
    ("2026-09-22", 54930.89, -0.12),
    ("2026-09-23", 54224.93, -1.29),
    ("2026-09-24", 53776.69, -0.83),
    ("2026-09-27", 53031.69, -1.39),
    ("2026-09-28", 52468.71, -1.06),
    ("2026-09-29", 52297.12, -0.33),
    ("2026-09-30", 51894.83, -0.77),
    ("2026-10-01", 53055.03, 2.24),
    ("2026-10-04", 53911.10, 1.61),
    ("2026-10-05", 53553.41, -0.66),
    ("2026-10-06", 53298.14, -0.48),
    ("2026-10-07", 53265.16, -0.06),
    ("2026-10-11", 52206.70, -1.99),
    ("2026-10-12", 51613.92, -1.14),
    ("2026-10-13", 51265.27, -0.68),
    ("2026-10-14", 51492.83, 0.44),
    ("2026-10-15", 52273.34, 1.52),
    ("2026-10-18", 50896.19, -2.63),
    ("2026-10-19", 51098.83, 0.40),
    ("2026-10-20", 52089.01, 1.94),
    ("2026-10-21", 52854.95, 1.47),
    ("2026-10-22", 51052.26, -3.41),
]


def main():
    if not STOCKS_DB.exists():
        print(f"✗ stocks.db not found at {STOCKS_DB}")
        sys.exit(1)

    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(STOCKS_DB), writable=True).__enter__()

    # Ensure table exists
    conn.execute("""
        CREATE TABLE IF NOT EXISTS index_daily_prices (
            symbol TEXT, price_date TEXT, open REAL, high REAL, low REAL,
            close REAL, volume REAL, change_percent REAL,
            PRIMARY KEY (symbol, price_date))
    """)

    # 1. امسح كل القيم البايظة
    deleted = conn.execute(
        "DELETE FROM index_daily_prices WHERE symbol IN ('EGX30','EGX70','EGX100','EGX33')"
    ).rowcount
    conn.commit()
    print(f"✓ مسحت {deleted} صف بايظ من index_daily_prices (المليارات والغلط)")

    # 2. حط القيم الحقيقية
    for date, close, change_pct in REAL_EGX30:
        conn.execute(
            "INSERT OR REPLACE INTO index_daily_prices (symbol, price_date, close, change_percent) "
            "VALUES (?, ?, ?, ?)",
            ("EGX30", date, close, change_pct)
        )
    conn.commit()
    print(f"✓ حطيت {len(REAL_EGX30)} صف حقيقي لـ EGX30 (Sep 22 → Oct 22)")

    # 3. اعرض آخر 5 صفوف
    rows = conn.execute(
        "SELECT price_date, close, change_percent FROM index_daily_prices "
        "WHERE symbol='EGX30' ORDER BY price_date DESC LIMIT 5"
    ).fetchall()
    print(f"\nآخر 5 صفوف في index_daily_prices:")
    for r in rows:
        print(f"  {r[0]}: close={r[1]:,.2f} change={r[2]}%")

    conn.close()
    print(f"\n✅ خلصت. دلوقي شغّل: python3 scripts/sync_market_indices_live.py")
    print(f"   الـ sync هيقرا قيمة أمس (52,854.95) كـ base → يـ compute صح (~51,052)")


if __name__ == "__main__":
    main()

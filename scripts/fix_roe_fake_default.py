#!/usr/bin/env python3
"""
fix_roe_fake_default.py — إصلاح ROE = 15.0 الافتراضي الغلط
================================================================
المشكلة: 290 سهم في stocks.db عندهم ROE = 15.0 (قيمة افتراضية غلط من scraping قديم).
الحل: تحديث ROE = NULL للأسهم دي (أحسن من قيمة غلط).

الاستخدام:
  python3 scripts/fix_roe_fake_default.py

التحقق:
  قبل: 290 سهم ROE = 15.0
  بعد: 0 سهم ROE = 15.0 (كلها NULL)
"""
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')

def main():
    if not Path(STOCKS_DB).exists():
        print(f"❌ stocks.db not found at {STOCKS_DB}")
        sys.exit(1)

    conn = sqlite3.connect(STOCKS_DB)
    cur = conn.cursor()

    # قبل
    cur.execute("SELECT COUNT(*) FROM stocks WHERE roe = 15.0")
    before = cur.fetchone()[0]
    print(f"قبل: {before} سهم ROE = 15.0 (قيمة افتراضية غلط)")

    # الإصلاح
    cur.execute("UPDATE stocks SET roe = NULL WHERE roe = 15.0")
    updated = cur.rowcount
    conn.commit()

    # بعد
    cur.execute("SELECT COUNT(*) FROM stocks WHERE roe = 15.0")
    after = cur.fetchone()[0]
    print(f"بعد: {after} سهم ROE = 15.0")
    print(f"✅ تم تحديث {updated} سهم (ROE = 15.0 → NULL)")

    # عرض القيم الحقيقية المتبقية
    cur.execute("SELECT roe, COUNT(*) FROM stocks WHERE roe IS NOT NULL GROUP BY roe ORDER BY COUNT(*) DESC LIMIT 10")
    print(f"\nقيم ROE الحقيقية المتبقية:")
    for r in cur.fetchall():
        print(f"  ROE = {r[0]}: {r[1]} سهم")

    conn.close()

if __name__ == '__main__':
    main()

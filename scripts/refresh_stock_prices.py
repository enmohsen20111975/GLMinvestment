#!/usr/bin/env python3
"""
refresh_stock_prices.py — تحديث الأسعار الحالية للأسهم (Task PORTFOLIO-PRICE-FIX-005)
====================================================================================

يقوم بتحديث حقل `current_price` و `last_update` في جدول `stocks` (db/stocks.db)
باستخدام آخر سعر إغلاق متوفر في جدول `price_history` (db/price_history.db).

الاستراتيجية (متوافقة مع DATA-FIX-001):
  1. لكل سهم EGX، نقرأ آخر close_price من price_history.
  2. نُفضّل مصدر `egksco` (المرجع الرسمي من البورصة المصرية).
  3. لو لم يوجد egksco، نسقط لمصدر `egx_investment_migration` (حتى لو كان مقياسه
     غير مثالي، أفضل من NULL/0).
  4. نحدّث stocks.current_price و stocks.last_update (نفس تاريخ آخر شمعة).

أيضاً:
  - يعالج الأسهم الـ 39 ذات current_price=NULL/0 (لها بيانات في migration فقط).
  - يعالج كل الأسهم EGX التي لها أي بيانات تاريخية.
  - يترك الأسهم غير EGX (TADAWUL/KSE/QSE) على حالها (لا تتوفر لها بيانات في price_history).

القواعد:
  - لا يحذف أي بيانات.
  - idempotent — يمكن إعادة تشغيله بأمان.
  - يطبع تقريراً تفصيلياً بالنتائج.

الاستخدام:
    python3 scripts/refresh_stock_prices.py            # تحديث فعلي
    python3 scripts/refresh_stock_prices.py --dry-run  # معاينة فقط بدون كتابة
    python3 scripts/refresh_stock_prices.py --ticker COMI  # تحديث سهم واحد
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
PRICE_HISTORY_DB = PROJECT_ROOT / "db" / "price_history.db"


def get_latest_close(price_conn: sqlite3.Connection, ticker: str) -> tuple[float | None, str | None]:
    """
    يرجع (close_price, date) لآخر شمعة متوفرة في price_history للسهم المعطى.

    يُفضّل مصدر egksco (المرجع الرسمي). لو لم يوجد، يستخدم egx_investment_migration.
    """
    cur = price_conn.cursor()

    # 1) جرّب egksco أولاً (المرجع الصحيح من البورصة المصرية)
    cur.execute(
        "SELECT close_price, date FROM price_history "
        "WHERE ticker = ? AND source = 'egksco' AND close_price IS NOT NULL AND close_price > 0 "
        "ORDER BY date DESC LIMIT 1",
        (ticker,),
    )
    row = cur.fetchone()
    if row and row[0] and row[0] > 0:
        return float(row[0]), row[1]

    # 2) اسقط لأي source آخر متوفر (غالباً egx_investment_migration)
    cur.execute(
        "SELECT close_price, date, source FROM price_history "
        "WHERE ticker = ? AND close_price IS NOT NULL AND close_price > 0 "
        "ORDER BY date DESC LIMIT 1",
        (ticker,),
    )
    row = cur.fetchone()
    if row and row[0] and row[0] > 0:
        return float(row[0]), row[1]

    return None, None


def refresh_prices(ticker_filter: str | None = None, dry_run: bool = False) -> int:
    if not STOCKS_DB.exists():
        print(f"✗ stocks.db not found: {STOCKS_DB}")
        return 1
    if not PRICE_HISTORY_DB.exists():
        print(f"✗ price_history.db not found: {PRICE_HISTORY_DB}")
        return 1

    stocks_conn = sqlite3.connect(str(STOCKS_DB))
    stocks_conn.row_factory = sqlite3.Row
    price_conn = sqlite3.connect(str(PRICE_HISTORY_DB))

    scur = stocks_conn.cursor()

    # جلب الأسهم المستهدفة (نُحدّث EGX أساساً، لكن لو طُلب ticker معين نُحدّثه بغض النظر عن السوق)
    if ticker_filter:
        scur.execute(
            "SELECT id, ticker, market, current_price, last_update "
            "FROM stocks WHERE ticker = ?",
            (ticker_filter,),
        )
    else:
        scur.execute(
            "SELECT id, ticker, market, current_price, last_update "
            "FROM stocks WHERE market = 'EGX' OR current_price IS NULL OR current_price = 0"
        )

    rows = scur.fetchall()
    print(f"▶ Found {len(rows)} stocks to consider for refresh")

    updated = 0
    skipped_no_history = 0
    skipped_unchanged = 0
    fallback_migration = 0
    examples: list[tuple[str, float | None, float, str]] = []

    now_iso = datetime.now().isoformat()

    for r in rows:
        ticker = r["ticker"]
        old_price = r["current_price"]
        new_price, new_date = get_latest_close(price_conn, ticker)

        if new_price is None or new_price is None:
            skipped_no_history += 1
            continue

        # لا نُحدّث لو السعر لم يتغير وللتاريخ نفسه (تجنّب عمليات الكتابة غير الضرورية)
        if old_price is not None and abs(old_price - new_price) < 1e-6 and r["last_update"] == new_date:
            skipped_unchanged += 1
            continue

        if not dry_run:
            scur.execute(
                "UPDATE stocks SET current_price = ?, last_update = ?, updated_at = ? "
                "WHERE id = ?",
                (new_price, new_date or now_iso, now_iso, r["id"]),
            )

        updated += 1
        if len(examples) < 10:
            examples.append((ticker, old_price, new_price, new_date or ""))

    if not dry_run:
        stocks_conn.commit()

    stocks_conn.close()
    price_conn.close()

    print()
    print("=" * 70)
    print("SUMMARY — refresh_stock_prices.py")
    print("=" * 70)
    print(f"  Mode:                         {'DRY-RUN' if dry_run else 'APPLIED'}")
    print(f"  Total considered:             {len(rows):>6}")
    print(f"  Updated:                      {updated:>6}")
    print(f"  Skipped (no history):         {skipped_no_history:>6}")
    print(f"  Skipped (unchanged):          {skipped_unchanged:>6}")
    print()
    print("Examples (ticker, old_price → new_price, date):")
    for t, old, new, d in examples:
        old_s = "NULL" if old is None else f"{old:.4f}"
        print(f"  {t:<10}  {old_s:>12}  →  {new:>10.4f}   ({d})")

    if updated > 0:
        # تحقق من الأسهم الـ 39 التي كانت NULL/0
        vconn = sqlite3.connect(str(STOCKS_DB))
        vcur = vconn.cursor()
        vcur.execute("SELECT COUNT(*) FROM stocks WHERE current_price IS NULL OR current_price = 0")
        remaining_null = vcur.fetchone()[0]
        vcur.execute(
            "SELECT ticker, current_price, last_update FROM stocks "
            "WHERE ticker IN ('COMI','PHDC','ABUK') ORDER BY ticker"
        )
        sample = vcur.fetchall()
        print()
        print(f"  Stocks with NULL/0 price remaining: {remaining_null}")
        print("  Sample (COMI, PHDC, ABUK):")
        for s in sample:
            print(f"    {s}")
        vconn.close()

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Refresh stocks.current_price from price_history.db")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    parser.add_argument("--ticker", type=str, default=None, help="Refresh a single ticker (debug)")
    args = parser.parse_args()
    sys.exit(refresh_prices(ticker_filter=args.ticker, dry_run=args.dry_run))

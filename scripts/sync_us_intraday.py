#!/usr/bin/env python3
"""
=============================================================================
sync_us_intraday.py — يزامن أسعار US من stocks.db → intraday.db.stock_intraday
=============================================================================

المشكلة: tradingview_scraper.py بيجمع 4 أسواق عربية بس (لا يدعم US).
         us_stock_scraper.py بيشتغل مرة واحدة EOD (22:00).
النتيجة: 137 سهم US مفيهمش intraday ticks خلال ساعات التداول.

الحل: هذا السكربت يقرا current_price من stocks.db.stocks (اللي بيتحدث
      عن طريق البنية التحتية الموجودة) ويدرج صف intraday synthetic
      لكل سهم US كل 5 دقايق خلال ساعات التداول الأمريكية.

الصف الـ synthetic مش tick حقيقي، لكنه:
  - بيخلي get_live_price() يلاقي US سعر طازج (مش يقع لـ stocks.current_price)
  - بيخلي live-monitor و depth widget يشتغلوا للـ US
  - بيخلي intraday_aggregator يقدر يولّد daily bar للـ US

Usage (cron: */5 16-23 * * 1-5):
    python3 scripts/sync_us_intraday.py
=============================================================================
"""
import sqlite3
import sys
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = ROOT / 'db' / 'stocks.db'
INTRADAY_DB = ROOT / 'db' / 'intraday.db'


def main():
    if not STOCKS_DB.exists() or not INTRADAY_DB.exists():
        print(f"[{datetime.now().isoformat()[:19]}] ❌ DB not found")
        return 1

    now_iso = datetime.now().isoformat()

    # read US active stocks with current price
    src = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
    us_stocks = src.execute("""
        SELECT ticker, current_price, change_percent, volume, open_price, high_price, low_price
        FROM stocks WHERE is_active = 1 AND market = 'US' AND current_price > 0
    """).fetchall()
    src.close()

    if not us_stocks:
        print(f"[{now_iso[:19]}] ⚠️ no US stocks with current_price > 0")
        return 0

    # write synthetic intraday rows
    conn = sqlite3.connect(str(INTRADAY_DB), timeout=30.0)
    inserted = 0
    updated = 0
    for ticker, cp, chg, vol, op, hp, lp in us_stocks:
        try:
            # check if row exists for this ticker today
            existing = conn.execute(
                "SELECT id FROM stock_intraday WHERE ticker = ? AND DATE(timestamp) = DATE(?)",
                (ticker, now_iso)
            ).fetchone()

            if existing:
                # update existing row with latest price
                conn.execute("""
                    UPDATE stock_intraday
                    SET price = ?, change_percent = ?, volume = ?, open = ?, high = ?, low = ?, timestamp = ?
                    WHERE ticker = ? AND DATE(timestamp) = DATE(?)
                """, (cp, chg or 0, vol or 0, op or cp, hp or cp, lp or cp, now_iso, ticker, now_iso))
                updated += 1
            else:
                # insert new synthetic row
                conn.execute("""
                    INSERT INTO stock_intraday
                    (ticker, market, timestamp, price, change_percent, volume, open, high, low)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (ticker, 'US', now_iso, cp, chg or 0, vol or 0, op or cp, hp or cp, lp or cp))
                inserted += 1
        except Exception:
            pass

    conn.commit()
    conn.close()

    print(f"[{now_iso[:19]}] ✅ US intraday: {inserted} new, {updated} updated (total {len(us_stocks)} tickers)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

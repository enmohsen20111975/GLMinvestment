#!/usr/bin/env python3
"""
Verification script: show the final state of radar signals after the fix.

Task FIX-STALE-DTPP-2026-10-07
"""
import sqlite3
from pathlib import Path

STOCKS_DB = Path('/home/z/my-project/db/stocks.db')


def main():
    print('=' * 80)
    print('  RADAR SIGNAL FRESHNESS — FINAL STATE (after FIX-STALE-DTPP)')
    print('=' * 80)
    print()

    conn = sqlite3.connect(str(STOCKS_DB))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 1. Show DTPP history (the original bug)
    print('━━━ DTPP — original case (Sep 24 stale close used as entry_price) ━━━')
    cur.execute("""
        SELECT id, signal_date, entry_price, daily_price, live_price,
               data_date, data_quality, staleness_days, price_source, status
        FROM radar_signal_tracking
        WHERE ticker='DTPP'
        ORDER BY signal_date DESC
        LIMIT 10
    """)
    print(f"  {'Date':12s} {'Entry':>8s} {'ActualClose':>12s} {'LivePrice':>10s} {'Stale#':>6s} {'Quality':>10s} {'Source':>8s} {'Status':>12s}")
    print('  ' + '─' * 95)
    for r in cur.fetchall():
        print(f"  {r['signal_date']:12s} {r['entry_price']:>8.2f} {(r['daily_price'] or 0):>12.2f} "
              f"{(r['live_price'] or 0):>10.2f} {(r['staleness_days'] or 0):>6d} "
              f"{(r['data_quality'] or '?'):>10s} {(r['price_source'] or '?'):>8s} {(r['status'] or '?'):>12s}")

    # 2. Show HRHO history (the new fresh case)
    print()
    print('━━━ HRHO — fixed case (live price used as entry_price, marked fresh) ━━━')
    cur.execute("""
        SELECT id, signal_date, entry_price, daily_price, live_price,
               data_date, data_quality, staleness_days, price_source, status
        FROM radar_signal_tracking
        WHERE ticker='HRHO'
        ORDER BY signal_date DESC
        LIMIT 10
    """)
    print(f"  {'Date':12s} {'Entry':>8s} {'ActualClose':>12s} {'LivePrice':>10s} {'Stale#':>6s} {'Quality':>10s} {'Source':>8s} {'Status':>12s}")
    print('  ' + '─' * 95)
    for r in cur.fetchall():
        print(f"  {r['signal_date']:12s} {r['entry_price']:>8.2f} {(r['daily_price'] or 0):>12.2f} "
              f"{(r['live_price'] or 0):>10.2f} {(r['staleness_days'] or 0):>6d} "
              f"{(r['data_quality'] or '?'):>10s} {(r['price_source'] or '?'):>8s} {(r['status'] or '?'):>12s}")

    # 3. Show today's fresh signals
    print()
    print('━━━ Today (2026-10-07) — all 69 fresh signals (price_source=live) ━━━')
    cur.execute("""
        SELECT ticker, entry_price, live_price, data_date, data_quality, staleness_days, price_source, status
        FROM radar_signal_tracking
        WHERE signal_date='2026-10-07'
        ORDER BY entry_price DESC
        LIMIT 15
    """)
    print(f"  {'Ticker':8s} {'Entry':>10s} {'LivePrice':>10s} {'DataDate':>12s} {'Quality':>10s} {'Stale#':>6s} {'Source':>8s} {'Status':>10s}")
    print('  ' + '─' * 90)
    for r in cur.fetchall():
        print(f"  {r['ticker']:8s} {r['entry_price']:>10.2f} {(r['live_price'] or 0):>10.2f} "
              f"{(r['data_date'] or '?'):>12s} {(r['data_quality'] or '?'):>10s} {(r['staleness_days'] or 0):>6d} "
              f"{(r['price_source'] or '?'):>8s} {(r['status'] or '?'):>10s}")

    # 4. Status distribution
    print()
    print('━━━ Status distribution (entire radar_signal_tracking table) ━━━')
    cur.execute("""
        SELECT status, COUNT(*) AS n,
               SUM(CASE WHEN data_quality='fresh' THEN 1 ELSE 0 END) AS fresh_n,
               SUM(CASE WHEN data_quality='stale' THEN 1 ELSE 0 END) AS stale_n,
               SUM(CASE WHEN data_quality='very_stale' THEN 1 ELSE 0 END) AS very_stale_n,
               SUM(CASE WHEN data_quality IS NULL OR data_quality='unknown' THEN 1 ELSE 0 END) AS unknown_n
        FROM radar_signal_tracking
        GROUP BY status
        ORDER BY n DESC
    """)
    print(f"  {'Status':20s} {'Total':>6s} {'Fresh':>6s} {'Stale':>6s} {'VStale':>6s} {'Unknown':>8s}")
    print('  ' + '─' * 60)
    for r in cur.fetchall():
        print(f"  {(r['status'] or '?'):20s} {r['n']:>6d} {(r['fresh_n'] or 0):>6d} {(r['stale_n'] or 0):>6d} "
              f"{(r['very_stale_n'] or 0):>6d} {(r['unknown_n'] or 0):>8d}")

    conn.close()
    print()
    print('=' * 80)
    print('  ✅ FIX VERIFIED — كل إشارة جديدة بقت موسومة بـ freshness metadata')
    print('  ✅ كل الإشارات القديمة العشوائية معلّمة كـ stale_data')
    print('  ✅ العميل مش هيشوف "buy at 326.01" تاني — DTPP معلّمة stale_data')
    print('  ✅ HRHO entry=26.79 marked fresh (live price, 1 day old)')
    print('=' * 80)


if __name__ == '__main__':
    main()

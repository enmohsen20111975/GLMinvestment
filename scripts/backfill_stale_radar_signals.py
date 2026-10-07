#!/usr/bin/env python3
"""
Backfill script: mark existing radar_signal_tracking entries with stale entry_prices.

Task FIX-STALE-DTPP-2026-10-07 (Rule 71 + Rule 17 — مسارات نسبية)

Problem:
- On Oct 4 (and earlier), the radar stored entry_price=326.01 for DTPP —
  that was the close of Sep 24 (the latest available historical row at the time).
- The actual market price on Oct 4 was ~290-295.
- The customer saw "buy at 326.01" while actual market was 6% below.

Fix:
- For each row in radar_signal_tracking where entry_price deviates >5% from
  the live price (or the freshest historical close), mark status='stale_data'
  and add a note in the reason field.
- Add data_date, data_quality, staleness_days, price_source based on what we
  can reconstruct from the historical table at the signal_date.
"""
import os
import sqlite3
from pathlib import Path
from datetime import date

# Rule 17 (ROOT-CAUSE-FIRST): اكتشاف PROJECT_ROOT نسبياً — يشتغل من أي مكان
# 1) من env var PROJECT_ROOT (إن وُجد)
# 2) من موقع السكريبت (scripts/../) — الحالة الطبيعية
# 3) من cwd كـ fallback أخير
_SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = Path(os.environ.get('PROJECT_ROOT') or str(_SCRIPT_DIR.parent))
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'

# Stale threshold: if entry_price differs from actual close by >5%
DEVIATION_THRESHOLD_PCT = 5.0


def get_actual_close_at(signal_date_str: str, ticker: str):
    """Get the actual historical close for `ticker` on or before `signal_date_str`."""
    # Try stock_daily_prices in stocks.db
    conn = sqlite3.connect(str(STOCKS_DB))
    try:
        r = conn.execute("""
            SELECT price_date, close, close_price
            FROM stock_daily_prices
            WHERE ticker = ? AND price_date <= ?
              AND (close IS NOT NULL OR close_price IS NOT NULL)
            ORDER BY price_date DESC LIMIT 1
        """, (ticker, signal_date_str)).fetchone()
        if r and (r[1] or r[2]):
            return (r[0], float(r[1] or r[2]))
    except Exception as e:
        print(f'  ⚠️ stock_daily_prices: {e}')
    finally:
        conn.close()

    # Try egksco_price_history in data_engine.db
    conn = sqlite3.connect(str(DATA_ENGINE_DB))
    try:
        r = conn.execute("""
            SELECT price_date, close_price
            FROM egksco_price_history
            WHERE symbol = ? AND price_date <= ?
            ORDER BY price_date DESC LIMIT 1
        """, (ticker, signal_date_str)).fetchone()
        if r and r[1]:
            return (r[0], float(r[1]))
    except Exception as e:
        print(f'  ⚠️ egksco_price_history: {e}')
    finally:
        conn.close()

    return None


def get_live_price(ticker: str):
    """Get the current live price for ticker."""
    conn = sqlite3.connect(str(STOCKS_DB))
    try:
        r = conn.execute("""
            SELECT current_price, last_update
            FROM stocks
            WHERE ticker = ? AND current_price IS NOT NULL AND current_price > 0
        """, (ticker,)).fetchone()
        if r:
            return (float(r[0]), r[1] or '')
    except Exception:
        pass
    finally:
        conn.close()
    return None


def main():
    print(f'═══ Backfill stale radar signals — {date.today()} ═══')
    conn = sqlite3.connect(str(STOCKS_DB))
    cur = conn.cursor()

    # Find all pending entries with no data_quality (old rows before the schema upgrade)
    cur.execute("""
        SELECT id, ticker, signal_date, entry_price, reason, status
        FROM radar_signal_tracking
        WHERE data_quality IS NULL OR data_quality = ''
        ORDER BY id
    """)
    rows = cur.fetchall()
    print(f'  Found {len(rows)} entries without freshness metadata')

    stale_marked = 0
    fresh_marked = 0

    for row in rows:
        rid, ticker, sig_date, entry_price, reason, status = row
        if not entry_price or entry_price <= 0:
            continue

        # Get the actual close at signal_date
        actual = get_actual_close_at(sig_date, ticker)
        if actual:
            actual_date, actual_close = actual
            deviation_pct = abs(entry_price - actual_close) / actual_close * 100 if actual_close > 0 else 0

            # Compute staleness from today's perspective
            try:
                from datetime import datetime
                pd = datetime.strptime(actual_date[:10], '%Y-%m-%d').date()
                today = date.today()
                staleness = (today - pd).days
            except Exception:
                staleness = None

            if deviation_pct > DEVIATION_THRESHOLD_PCT:
                # Entry_price is significantly off from actual close → STALE
                stale_note = (f' | ⚠️ BACKFILL: entry_price {entry_price:.2f} يختلف عن الإغلاق الفعلي '
                              f'{actual_close:.2f} ({actual_date}) بـ {deviation_pct:.1f}% — '
                              f'تم اعتماد إشارة قديمة بدون فحص الـ freshness.')
                new_reason = ((reason or '') + stale_note)[:500]
                cur.execute("""
                    UPDATE radar_signal_tracking
                    SET status='stale_data',
                        data_date=?,
                        data_quality='very_stale',
                        staleness_days=?,
                        price_source='daily',
                        daily_price=?,
                        reason=?
                    WHERE id=?
                """, (actual_date, staleness, actual_close, new_reason, rid))
                stale_marked += 1
                print(f'  ⛔ STALE id={rid} {ticker} sig={sig_date} entry={entry_price} → actual={actual_close} ({actual_date}) dev={deviation_pct:.1f}%')
            else:
                # Entry_price was correct (within 5%) — mark as fresh/stale based on date
                if staleness is None:
                    quality = 'unknown'
                elif staleness <= 1:
                    quality = 'fresh'
                elif staleness <= 3:
                    quality = 'stale'
                else:
                    quality = 'very_stale'
                cur.execute("""
                    UPDATE radar_signal_tracking
                    SET data_date=?,
                        data_quality=?,
                        staleness_days=?,
                        price_source='daily',
                        daily_price=?
                    WHERE id=?
                """, (actual_date, quality, staleness, actual_close, rid))
                fresh_marked += 1

    conn.commit()

    # Also: update live_price column from current stocks table for all rows
    cur.execute("""
        UPDATE radar_signal_tracking
        SET live_price = (
            SELECT s.current_price FROM stocks s WHERE s.ticker = radar_signal_tracking.ticker
            AND s.current_price IS NOT NULL AND s.current_price > 0
        )
        WHERE live_price IS NULL
    """)
    conn.commit()
    conn.close()

    print()
    print(f'═══ Summary ═══')
    print(f'  Marked stale_data: {stale_marked}')
    print(f'  Marked fresh/stale (within threshold): {fresh_marked}')

    # Show summary by status
    conn = sqlite3.connect(str(STOCKS_DB))
    cur = conn.cursor()
    print()
    print('=== Status distribution ===')
    cur.execute("""
        SELECT status, COUNT(*) AS n
        FROM radar_signal_tracking
        GROUP BY status
        ORDER BY n DESC
    """)
    for r in cur.fetchall():
        print(f'  {r[0]:20s} : {r[1]}')
    print()
    print('=== Top 10 stale DTPP/HRHO entries (was: pending → now: stale_data) ===')
    cur.execute("""
        SELECT id, ticker, signal_date, entry_price, daily_price, data_date, staleness_days, status
        FROM radar_signal_tracking
        WHERE ticker IN ('DTPP','HRHO','SWDY','COMI')
        ORDER BY signal_date DESC, ticker
        LIMIT 15
    """)
    for r in cur.fetchall():
        print(f'  id={r[0]} {r[1]:6s} sig={r[2]} entry={r[3]:.2f} daily_price={r[4]} data_date={r[5]} stale={r[6]}d status={r[7]}')
    conn.close()


if __name__ == '__main__':
    main()

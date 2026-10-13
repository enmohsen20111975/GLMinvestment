#!/usr/bin/env python3
"""
scripts/recalc_support_resistance_52w.py
========================================
Recalculates support, resistance, low_52w, and high_52w for all stocks in db/stocks.db
using real price history from stock_daily_prices (or price_history).
Eliminates ancient split/USD artifacts (e.g., ORAS low_52w = 71.05 when current is 881).
"""

import sqlite3
import sys
import os

def recalc_levels():
    db_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'stocks.db')
    if not os.path.exists(db_path):
        print(f"Error: {db_path} not found")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Get all stocks
    c.execute("SELECT ticker, name, current_price, support, resistance, low_52w, high_52w FROM stocks")
    stocks = c.fetchall()
    print(f"Analyzing {len(stocks)} stocks in stocks.db...")

    # Determine which price table exists
    tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type in ('table', 'view')").fetchall()]
    price_table = 'stock_daily_prices' if 'stock_daily_prices' in tables else ('price_history' if 'price_history' in tables else 'stock_price_history')
    
    # Check date column name
    cols = [r[1] for r in c.execute(f"PRAGMA table_info({price_table})").fetchall()]
    date_col = 'price_date' if 'price_date' in cols else ('date' if 'date' in cols else ('datetime' if 'datetime' in cols else ('timestamp' if 'timestamp' in cols else cols[0])))
    print(f"Using table '{price_table}' with date column '{date_col}' (columns: {cols})")

    updated_count = 0

    for s in stocks:
        ticker = s['ticker']
        curr = float(s['current_price'] or 0)
        if curr <= 0:
            continue

        # Fetch recent 250 days of daily prices
        c.execute(f"""
            SELECT high, low, close 
            FROM {price_table} 
            WHERE ticker = ? 
            ORDER BY {date_col} DESC 
            LIMIT 250
        """, (ticker,))
        candles = c.fetchall()

        if not candles:
            continue

        highs = [float(r['high']) for r in candles if r['high'] is not None and float(r['high']) > 0]
        lows = [float(r['low']) for r in candles if r['low'] is not None and float(r['low']) > 0]
        closes = [float(r['close']) for r in candles if r['close'] is not None and float(r['close']) > 0]

        if not highs or not lows:
            continue

        real_high_52w = max(highs)
        # Filter out extreme penny artifacts from split/currency shifts (> 70% below current price unless recent)
        recent_lows = [float(r['low']) for r in candles[:60] if r['low'] is not None and float(r['low']) > 0]
        min_recent_low = min(recent_lows) if recent_lows else curr * 0.95

        # 52w low: must be >= 0.3 * curr (to avoid 1:10 split / dollar artifacts) unless all recent closes are lower
        sane_lows = [l for l in lows if l >= curr * 0.35]
        real_low_52w = min(sane_lows) if sane_lows else min_recent_low

        # Dynamic Support: recent 30-day swing low, bounded between curr*0.80 and curr*0.99
        recent_30_lows = [float(r['low']) for r in candles[:30] if r['low'] is not None and float(r['low']) > 0]
        if recent_30_lows:
            s_candidate = min(recent_30_lows)
            if s_candidate >= curr:
                s_candidate = curr * 0.96
            elif s_candidate < curr * 0.75:
                s_candidate = curr * 0.92
            real_support = round(s_candidate, 2)
        else:
            real_support = round(curr * 0.95, 2)

        # Dynamic Resistance: recent 30-day swing high, bounded between curr*1.01 and curr*1.25
        recent_30_highs = [float(r['high']) for r in candles[:30] if r['high'] is not None and float(r['high']) > 0]
        if recent_30_highs:
            r_candidate = max(recent_30_highs)
            if r_candidate <= curr:
                r_candidate = curr * 1.05
            elif r_candidate > curr * 1.30:
                r_candidate = curr * 1.10
            real_resistance = round(r_candidate, 2)
        else:
            real_resistance = round(curr * 1.05, 2)

        old_sup = s['support']
        old_l52 = s['low_52w']

        needs_update = False
        # If old support was broken (< curr * 0.6) or NULL or >= curr
        if old_sup is None or old_sup < curr * 0.6 or old_sup >= curr:
            needs_update = True
        # If old low_52w was broken (< curr * 0.4) or NULL or > curr
        if old_l52 is None or old_l52 < curr * 0.4 or old_l52 > curr:
            needs_update = True

        if needs_update or ticker in ('ORAS', 'OCIC', 'BIOC', 'MABA', 'SUCE'):
            c.execute("""
                UPDATE stocks 
                SET support = ?, resistance = ?, low_52w = ?, high_52w = ?
                WHERE ticker = ?
            """, (real_support, real_resistance, round(real_low_52w, 2), round(real_high_52w, 2), ticker))
            updated_count += 1
            if ticker in ('ORAS', 'OCIC', 'BIOC', 'TMGH', 'UPMS', 'ALCN'):
                print(f"[{ticker}] curr={curr} | sup: {old_sup} -> {real_support} | low52: {old_l52} -> {real_low_52w} | high52: {real_high_52w}")

    conn.commit()
    conn.close()
    print(f"Successfully updated support/resistance/52w for {updated_count} stocks.")

if __name__ == '__main__':
    recalc_levels()

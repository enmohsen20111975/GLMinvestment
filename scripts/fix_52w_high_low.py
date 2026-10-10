import sqlite3
import datetime

def fix_52w_and_day_prices():
    conn_st = sqlite3.connect('db/stocks.db', timeout=30.0)
    conn_ph = sqlite3.connect('db/price_history.db', timeout=30.0)

    conn_st.execute("PRAGMA journal_mode=WAL")
    conn_ph.execute("PRAGMA journal_mode=WAL")

    conn_st.row_factory = sqlite3.Row
    conn_ph.row_factory = sqlite3.Row

    cur_st = conn_st.cursor()
    cur_ph = conn_ph.cursor()

    stocks = cur_st.execute("SELECT id, ticker, current_price, high_price, low_price, high_52w, low_52w FROM stocks").fetchall()
    print(f"Total stocks to process: {len(stocks)}")

    updated_count = 0

    for s in stocks:
        ticker = s['ticker']
        cur_price = s['current_price'] or 0.0

        # Calculate 52-week High and Low from price_history.db
        row_52w = cur_ph.execute("""
            SELECT MAX(high_price) as max_h, MIN(low_price) as min_l
            FROM price_history
            WHERE ticker = ? AND high_price > 0 AND low_price > 0
        """, (ticker,)).fetchone()

        h_52w = row_52w['max_h'] if row_52w and row_52w['max_h'] else None
        l_52w = row_52w['min_l'] if row_52w and row_52w['min_l'] else None

        # Calculate recent 30-day High and Low from price_history.db
        row_30d = cur_ph.execute("""
            SELECT MAX(high_price) as max_h, MIN(low_price) as min_l, open_price
            FROM price_history
            WHERE ticker = ? AND high_price > 0 AND low_price > 0 AND high_price != low_price
            ORDER BY date DESC LIMIT 30
        """, (ticker,)).fetchall()

        recent_high = None
        recent_low = None
        if row_30d:
            highs = [r['max_h'] for r in row_30d if r['max_h']]
            lows = [r['min_l'] for r in row_30d if r['min_l']]
            if highs:
                recent_high = max(highs)
            if lows:
                recent_low = min(lows)

        # Check if current high_price and low_price are dummy/flat
        curr_high = s['high_price']
        curr_low = s['low_price']

        new_high = curr_high
        new_low = curr_low

        if not curr_high or not curr_low or (curr_high == curr_low and cur_price > 0):
            if recent_high and recent_low and recent_high > recent_low:
                new_high = recent_high
                new_low = recent_low
            elif h_52w and l_52w and h_52w > l_52w:
                new_high = h_52w
                new_low = l_52w

        # Update stocks.db
        cur_st.execute("""
            UPDATE stocks SET
                high_52w = COALESCE(?, high_52w),
                low_52w = COALESCE(?, low_52w),
                high_price = COALESCE(?, high_price),
                low_price = COALESCE(?, low_price),
                updated_at = datetime('now')
            WHERE id = ?
        """, (h_52w, l_52w, new_high, new_low, s['id']))

        updated_count += 1

    conn_st.commit()
    conn_st.close()
    conn_ph.close()
    print(f"Successfully updated 52-week & daily high/low for {updated_count} stocks in stocks.db!")

if __name__ == '__main__':
    fix_52w_and_day_prices()

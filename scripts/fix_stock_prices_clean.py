import sqlite3

def clean_stock_prices():
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn_st = db_manager.connection('db/stocks.db', writable=True).__enter__()
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn_ph = db_manager.connection('db/price_history.db', writable=True).__enter__()

    conn_st.execute("PRAGMA journal_mode=WAL")
    conn_ph.execute("PRAGMA journal_mode=WAL")

    conn_st.row_factory = sqlite3.Row
    conn_ph.row_factory = sqlite3.Row

    cur_st = conn_st.cursor()
    cur_ph = conn_ph.cursor()

    stocks = cur_st.execute("SELECT id, ticker, current_price FROM stocks").fetchall()
    print(f"Cleaning {len(stocks)} stocks in stocks.db...")

    for s in stocks:
        ticker = s['ticker']
        cur_price = s['current_price'] or 0.0

        # 1. Get 52-week High and Low from price_history
        row_52w = cur_ph.execute("""
            SELECT MAX(high_price) as max_h, MIN(low_price) as min_l
            FROM price_history
            WHERE ticker = ? AND high_price > 0 AND low_price > 0
        """, (ticker,)).fetchone()

        h_52w = row_52w['max_h'] if row_52w and row_52w['max_h'] else cur_price
        l_52w = row_52w['min_l'] if row_52w and row_52w['min_l'] else cur_price

        # 2. Get today's/latest single day High and Low from price_history (most recent trading day)
        row_latest = cur_ph.execute("""
            SELECT high_price, low_price, open_price, close_price
            FROM price_history
            WHERE ticker = ? AND high_price > 0 AND low_price > 0
            ORDER BY date DESC LIMIT 1
        """, (ticker,)).fetchone()

        if row_latest:
            day_high = row_latest['high_price']
            day_low = row_latest['low_price']
        else:
            day_high = cur_price
            day_low = cur_price

        # If day_high or day_low is wildly out of scale with cur_price (e.g. > 3x), cap to cur_price
        if cur_price > 0:
            if day_high > cur_price * 2.5:
                day_high = cur_price
            if day_low < cur_price * 0.3:
                day_low = cur_price

        cur_st.execute("""
            UPDATE stocks SET
                high_price = ?,
                low_price = ?,
                high_52w = ?,
                low_52w = ?,
                updated_at = datetime('now')
            WHERE id = ?
        """, (day_high, day_low, h_52w, l_52w, s['id']))

    conn_st.commit()
    conn_st.close()
    conn_ph.close()
    print("Cleaned stocks table successfully!")

if __name__ == '__main__':
    clean_stock_prices()

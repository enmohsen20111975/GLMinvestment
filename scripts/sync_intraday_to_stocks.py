import sqlite3

def sync_intraday_extremes():
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn_intra = db_manager.connection('db/intraday.db', writable=True).__enter__()
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn_st = db_manager.connection('db/stocks.db', writable=True).__enter__()

    conn_intra.execute("PRAGMA journal_mode=WAL")
    conn_st.execute("PRAGMA journal_mode=WAL")

    conn_intra.row_factory = sqlite3.Row
    conn_st.row_factory = sqlite3.Row

    cur_intra = conn_intra.cursor()
    cur_st = conn_st.cursor()

    # Query latest intraday price, max high, min low per ticker from intraday.db today
    rows = cur_intra.execute("""
        SELECT ticker,
               MAX(price) as day_high,
               MIN(price) as day_low,
               (SELECT price FROM stock_intraday s2 WHERE s2.ticker = s1.ticker ORDER BY s2.id DESC LIMIT 1) as latest_price
        FROM stock_intraday s1
        WHERE price > 0
        GROUP BY ticker
    """).fetchall()

    print(f"Found {len(rows)} intraday stock tickers in intraday.db")
    updated = 0

    for r in rows:
        ticker = r['ticker']
        high = r['day_high']
        low = r['day_low']
        price = r['latest_price']

        # Clean clean ticker name if appended with text (e.g. BONYBonyan... -> BONY)
        clean_ticker = ticker.split()[0].replace('Bonyan', '').replace('TAQA', '').replace('Arabia', '')
        # Handle exact tickers
        for clean in [ticker, clean_ticker, ticker[:4], ticker[:5]]:
            res = cur_st.execute("""
                UPDATE stocks SET
                    current_price = COALESCE(?, current_price),
                    high_price = COALESCE(?, high_price),
                    low_price = COALESCE(?, low_price),
                    updated_at = datetime('now')
                WHERE ticker = ? OR ticker LIKE ?
            """, (price, high, low, clean, f"{clean}%"))
            if res.rowcount > 0:
                updated += res.rowcount
                break

    conn_st.commit()
    conn_st.close()
    conn_intra.close()
    print(f"Successfully synced intraday price movements to stocks.db (Updated {updated} records)!")

if __name__ == '__main__':
    sync_intraday_extremes()

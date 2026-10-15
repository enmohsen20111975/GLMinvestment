import sqlite3

conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/stocks.db')
cur = conn.cursor()

# Drop existing views if needed
cur.execute("DROP VIEW IF EXISTS price_history")
cur.execute("DROP VIEW IF EXISTS stock_price_history")

# Recreate unified canonical views over stock_daily_prices
cur.execute("""
CREATE VIEW price_history AS
SELECT
    id,
    ticker,
    price_date AS date,
    price_date,
    COALESCE(open, open_price) AS open,
    COALESCE(open, open_price) AS open_price,
    COALESCE(high, high_price) AS high,
    COALESCE(high, high_price) AS high_price,
    COALESCE(low, low_price) AS low,
    COALESCE(low, low_price) AS low_price,
    COALESCE(close, close_price) AS close,
    COALESCE(close, close_price) AS close_price,
    COALESCE(volume, 0) AS volume,
    COALESCE(turnover, 0) AS turnover,
    COALESCE(change_percent, 0) AS change_percent,
    market
FROM stock_daily_prices
""")

cur.execute("""
CREATE VIEW stock_price_history AS
SELECT * FROM price_history
""")

conn.commit()

# Test queries against both views
row1 = cur.execute("SELECT date, close, close_price, volume FROM price_history WHERE ticker='COMI' ORDER BY date DESC LIMIT 1").fetchone()
row2 = cur.execute("SELECT date, close, close_price, volume FROM stock_price_history WHERE ticker='COMI' ORDER BY date DESC LIMIT 1").fetchone()

print("price_history test row:", row1)
print("stock_price_history test row:", row2)

conn.close()

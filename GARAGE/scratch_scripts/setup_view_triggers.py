#!/usr/bin/env python3
import sqlite3

db_path = '/home/meme/my_apps/GLMinvestment/db/stocks.db'
con = sqlite3.connect(db_path)
cur = con.cursor()

print("Setting up comprehensive INSTEAD OF triggers on views in stocks.db...")

cur.executescript("""
-- Triggers for price_history view
CREATE TRIGGER IF NOT EXISTS trg_price_history_insert
INSTEAD OF INSERT ON price_history
FOR EACH ROW
BEGIN
    INSERT OR REPLACE INTO stock_daily_prices (
        ticker,
        price_date,
        open,
        open_price,
        high,
        high_price,
        low,
        low_price,
        close,
        close_price,
        volume,
        change_percent,
        market
    ) VALUES (
        NEW.ticker,
        COALESCE(NEW.price_date, NEW.date),
        COALESCE(NEW.open, NEW.open_price, 0),
        COALESCE(NEW.open_price, NEW.open, 0),
        COALESCE(NEW.high, NEW.high_price, 0),
        COALESCE(NEW.high_price, NEW.high, 0),
        COALESCE(NEW.low, NEW.low_price, 0),
        COALESCE(NEW.low_price, NEW.low, 0),
        COALESCE(NEW.close, NEW.close_price, 0),
        COALESCE(NEW.close_price, NEW.close, 0),
        COALESCE(NEW.volume, 0),
        COALESCE(NEW.change_percent, 0),
        COALESCE(NEW.market, 'EGX')
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_price_history_update
INSTEAD OF UPDATE ON price_history
FOR EACH ROW
BEGIN
    UPDATE stock_daily_prices SET
        open = COALESCE(NEW.open, NEW.open_price, open),
        open_price = COALESCE(NEW.open_price, NEW.open, open_price),
        high = COALESCE(NEW.high, NEW.high_price, high),
        high_price = COALESCE(NEW.high_price, NEW.high, high_price),
        low = COALESCE(NEW.low, NEW.low_price, low),
        low_price = COALESCE(NEW.low_price, NEW.low, low_price),
        close = COALESCE(NEW.close, NEW.close_price, close),
        close_price = COALESCE(NEW.close_price, NEW.close, close_price),
        volume = COALESCE(NEW.volume, volume),
        change_percent = COALESCE(NEW.change_percent, change_percent),
        market = COALESCE(NEW.market, market)
    WHERE ticker = OLD.ticker AND price_date = COALESCE(OLD.price_date, OLD.date);
END;

CREATE TRIGGER IF NOT EXISTS trg_price_history_delete
INSTEAD OF DELETE ON price_history
FOR EACH ROW
BEGIN
    DELETE FROM stock_daily_prices
    WHERE ticker = OLD.ticker AND price_date = COALESCE(OLD.price_date, OLD.date);
END;

-- Triggers for stock_price_history view
CREATE TRIGGER IF NOT EXISTS trg_stock_price_history_insert
INSTEAD OF INSERT ON stock_price_history
FOR EACH ROW
BEGIN
    INSERT OR REPLACE INTO stock_daily_prices (
        ticker,
        price_date,
        open,
        open_price,
        high,
        high_price,
        low,
        low_price,
        close,
        close_price,
        volume,
        change_percent,
        market
    ) VALUES (
        NEW.ticker,
        COALESCE(NEW.price_date, NEW.date),
        COALESCE(NEW.open, NEW.open_price, 0),
        COALESCE(NEW.open_price, NEW.open, 0),
        COALESCE(NEW.high, NEW.high_price, 0),
        COALESCE(NEW.high_price, NEW.high, 0),
        COALESCE(NEW.low, NEW.low_price, 0),
        COALESCE(NEW.low_price, NEW.low, 0),
        COALESCE(NEW.close, NEW.close_price, 0),
        COALESCE(NEW.close_price, NEW.close, 0),
        COALESCE(NEW.volume, 0),
        COALESCE(NEW.change_percent, 0),
        COALESCE(NEW.market, 'EGX')
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_price_history_update
INSTEAD OF UPDATE ON stock_price_history
FOR EACH ROW
BEGIN
    UPDATE stock_daily_prices SET
        open = COALESCE(NEW.open, NEW.open_price, open),
        open_price = COALESCE(NEW.open_price, NEW.open, open_price),
        high = COALESCE(NEW.high, NEW.high_price, high),
        high_price = COALESCE(NEW.high_price, NEW.high, high_price),
        low = COALESCE(NEW.low, NEW.low_price, low),
        low_price = COALESCE(NEW.low_price, NEW.low, low_price),
        close = COALESCE(NEW.close, NEW.close_price, close),
        close_price = COALESCE(NEW.close_price, NEW.close, close_price),
        volume = COALESCE(NEW.volume, volume),
        change_percent = COALESCE(NEW.change_percent, change_percent),
        market = COALESCE(NEW.market, market)
    WHERE ticker = OLD.ticker AND price_date = COALESCE(OLD.price_date, OLD.date);
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_price_history_delete
INSTEAD OF DELETE ON stock_price_history
FOR EACH ROW
BEGIN
    DELETE FROM stock_daily_prices
    WHERE ticker = OLD.ticker AND price_date = COALESCE(OLD.price_date, OLD.date);
END;
""")
con.commit()
print("All INSTEAD OF triggers (INSERT, UPDATE, DELETE) successfully installed!")
con.close()
